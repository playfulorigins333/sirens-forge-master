-- ADR Gates 7-13: extend the canonical CPQ job state for dormant Fanvue execution.
-- Forward-only, no backfill, no provider calls, and no public/cron activation.
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_no_fanvue;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_platform_jobs_job_state_check;
alter table public.creator_publishing_platform_jobs add constraint creator_publishing_platform_jobs_job_state_check check (job_state in (
 'draft','ready_to_publish','direct_publish_queued','publishing_direct','published_direct','direct_publish_failed','retry_scheduled','authentication_required','platform_rejected',
 'scheduled_internally','awaiting_operator','due_now','claimed','scheduled_on_platform','awaiting_post_confirmation','confirmed_posted_manual','failed_manual_upload','needs_fix','skipped','blocked','archived','package_ready','ready_for_export','exported',
 'reconnect_required','uncertain','cancelled'));
alter table public.creator_publishing_platform_jobs
 add constraint creator_publishing_jobs_id_creator_unique unique(id,creator_id),
 add column oauth_account_id uuid,
 add column publication_type text,
 add column requested_publication_at timestamptz,
 add column server_idempotency_key text,
 add column attempt_count integer not null default 0,
 add column next_attempt_at timestamptz,
 add column lease_token uuid,
 add column leased_at timestamptz,
 add column posted_at timestamptz,
 add column terminal_classification text,
 add column safe_error_code text,
 add column provider_post_uuid uuid,
 add constraint creator_publishing_fanvue_oauth_owner_fk foreign key(oauth_account_id,creator_id,target_platform) references public.autopost_accounts(id,user_id,platform) on delete restrict,
 add constraint creator_publishing_fanvue_execution_shape_check check (target_platform<>'fanvue' or (oauth_account_id is not null and publication_type in ('text','image','video') and requested_publication_at is not null and server_idempotency_key is not null)),
 add constraint creator_publishing_fanvue_attempt_count_check check(attempt_count between 0 and 3),
 add constraint creator_publishing_fanvue_terminal_check check(terminal_classification is null or terminal_classification in ('success','permanent','reconnect_required','uncertain'));
create unique index creator_publishing_fanvue_server_idempotency_uidx on public.creator_publishing_platform_jobs(creator_id,server_idempotency_key) where target_platform='fanvue';
create unique index creator_publishing_fanvue_provider_proof_uidx on public.creator_publishing_platform_jobs(provider_post_uuid) where provider_post_uuid is not null;
create index creator_publishing_fanvue_due_idx on public.creator_publishing_platform_jobs(requested_publication_at,next_attempt_at) where target_platform='fanvue' and job_state in ('direct_publish_queued','retry_scheduled');

create table public.creator_publishing_fanvue_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.creator_publishing_platform_jobs(id) on delete cascade,
 creator_id uuid not null references auth.users(id) on delete cascade, attempt_ordinal integer not null check(attempt_ordinal between 1 and 3),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 outcome_class text check(outcome_class in ('success','retryable_pre_create','permanent','reconnect_required','uncertain')),
 provider_create_attempted boolean not null default false, upload_attempted boolean not null default false, refresh_attempted boolean not null default false,
 safe_error_code text, status_class text, provider_post_uuid uuid, uncertainty_classification text,
 created_at timestamptz not null default clock_timestamp(),
 constraint creator_publishing_fanvue_attempt_job_owner_fk foreign key(job_id,creator_id) references public.creator_publishing_platform_jobs(id,creator_id) on delete cascade,
 constraint creator_publishing_fanvue_attempt_ordinal_unique unique(job_id,attempt_ordinal),
 constraint creator_publishing_fanvue_attempt_proof_outcome_check check(provider_post_uuid is null or outcome_class='success'),
 constraint creator_publishing_fanvue_attempt_uncertain_check check(outcome_class<>'uncertain' or (provider_create_attempted and provider_post_uuid is null and uncertainty_classification is not null))
);
create unique index creator_publishing_fanvue_attempt_provider_proof_uidx on public.creator_publishing_fanvue_attempts(provider_post_uuid) where provider_post_uuid is not null;

alter table public.creator_publishing_fanvue_attempts enable row level security;
create policy creator_publishing_fanvue_attempts_select_own on public.creator_publishing_fanvue_attempts for select to authenticated using(creator_id=auth.uid());
grant select on public.creator_publishing_fanvue_attempts to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.creator_publishing_fanvue_attempts from anon,authenticated;

create or replace function public.creator_publishing_claim_due_fanvue_jobs(p_limit integer default 1,p_lease_minutes integer default 15)
returns table(job_id uuid,lease_token uuid,attempt_ordinal integer) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_limit<1 or p_limit>10 or p_lease_minutes<1 or p_lease_minutes>30 then raise exception 'FANVUE_CLAIM_ARGUMENT_INVALID'; end if;
 return query with eligible as (
  select j.id from public.creator_publishing_platform_jobs j
  where j.target_platform='fanvue' and j.attempt_count<3 and j.requested_publication_at<=clock_timestamp()
   and (j.next_attempt_at is null or j.next_attempt_at<=clock_timestamp())
   and (j.job_state in ('direct_publish_queued','retry_scheduled') or (j.job_state='publishing_direct' and j.leased_at<clock_timestamp()-make_interval(mins=>p_lease_minutes)))
  order by coalesce(j.next_attempt_at,j.requested_publication_at),j.id for update skip locked limit p_limit
 ), claimed as (update public.creator_publishing_platform_jobs j set job_state='publishing_direct',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),attempt_count=j.attempt_count+1,updated_at=clock_timestamp() from eligible e where j.id=e.id returning j.id,j.lease_token,j.attempt_count)
 select id,claimed.lease_token,attempt_count from claimed;
end $$;
revoke all on function public.creator_publishing_claim_due_fanvue_jobs(integer,integer) from public,anon,authenticated;
grant execute on function public.creator_publishing_claim_due_fanvue_jobs(integer,integer) to service_role;

create or replace function public.creator_publishing_finish_fanvue_attempt(p_job_id uuid,p_lease_token uuid,p_outcome text,p_provider_create_attempted boolean,p_upload_attempted boolean,p_refresh_attempted boolean,p_safe_error_code text,p_status_class text,p_provider_post_uuid uuid default null,p_next_attempt_at timestamptz default null,p_uncertainty_classification text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.creator_publishing_platform_jobs%rowtype; new_state text; terminal text;
begin
 select * into j from public.creator_publishing_platform_jobs where id=p_job_id and target_platform='fanvue' for update;
 if not found or j.job_state<>'publishing_direct' or j.lease_token<>p_lease_token then return false; end if;
 if p_outcome not in ('success','retryable_pre_create','permanent','reconnect_required','uncertain') then raise exception 'FANVUE_OUTCOME_INVALID'; end if;
 if p_outcome='success' and p_provider_post_uuid is null then raise exception 'FANVUE_PROVIDER_PROOF_REQUIRED'; end if;
 if p_outcome='uncertain' and (not p_provider_create_attempted or p_provider_post_uuid is not null or p_uncertainty_classification is null) then raise exception 'FANVUE_UNCERTAIN_INVALID'; end if;
 if p_outcome='retryable_pre_create' and (p_provider_create_attempted or p_next_attempt_at is null or j.attempt_count>=3) then raise exception 'FANVUE_RETRY_INVALID'; end if;
 new_state:=case p_outcome when 'success' then 'published_direct' when 'retryable_pre_create' then 'retry_scheduled' when 'reconnect_required' then 'reconnect_required' when 'uncertain' then 'uncertain' else 'direct_publish_failed' end;
 terminal:=case when p_outcome='retryable_pre_create' then null else p_outcome end;
 insert into public.creator_publishing_fanvue_attempts(job_id,creator_id,attempt_ordinal,finished_at,outcome_class,provider_create_attempted,upload_attempted,refresh_attempted,safe_error_code,status_class,provider_post_uuid,uncertainty_classification)
 values(j.id,j.creator_id,j.attempt_count,clock_timestamp(),p_outcome,p_provider_create_attempted,p_upload_attempted,p_refresh_attempted,p_safe_error_code,p_status_class,p_provider_post_uuid,p_uncertainty_classification);
 update public.creator_publishing_platform_jobs set job_state=new_state,next_attempt_at=case when p_outcome='retryable_pre_create' then p_next_attempt_at else null end,posted_at=case when p_outcome='success' then clock_timestamp() else null end,terminal_classification=terminal,safe_error_code=p_safe_error_code,provider_post_uuid=p_provider_post_uuid,lease_token=null,leased_at=null,updated_at=clock_timestamp() where id=j.id;
 return true;
end $$;
revoke all on function public.creator_publishing_finish_fanvue_attempt(uuid,uuid,text,boolean,boolean,boolean,text,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.creator_publishing_finish_fanvue_attempt(uuid,uuid,text,boolean,boolean,boolean,text,text,uuid,timestamptz,text) to service_role;

create or replace view public.creator_publishing_fanvue_history with(security_invoker=true) as select id,creator_id,content_package_id,platform_account_id destination_id,publication_type,requested_publication_at,job_state,next_attempt_at,posted_at,safe_error_code,created_at,updated_at from public.creator_publishing_platform_jobs where target_platform='fanvue';
grant select on public.creator_publishing_fanvue_history to authenticated;
