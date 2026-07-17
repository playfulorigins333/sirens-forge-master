begin;

-- Task 18 preflight: existing rows must already satisfy the final invariants.
do $$
begin
  if exists (
    select 1 from public.creator_publishing_queue_tasks
    where (
      status='confirmed_posted_manual' and not (
        posted_by is not null and posted_at is not null and posted_confirmation is true
        and operator_progress_state='handoff_ready'
        and length(btrim(coalesce(proof_screenshot_storage_key,''))) > 0
        and proof_screenshot_storage_key like 'operator-completion-evidence/%'
        and (
          (
            final_post_url is not null
            and length(btrim(final_post_url)) > 0
            and final_post_url ~ '^https://onlyfans\.com/[0-9]+/[A-Za-z0-9._-]+$'
            and final_post_url_skip_reason is null
          )
          or
          (
            final_post_url is null
            and final_post_url_skip_reason is not null
            and final_post_url_skip_reason in ('platform_did_not_expose_stable_url','post_completed_without_shareable_url','account_owner_declined_url_capture')
          )
        ) is true
        and skip_or_fail_reason is null and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null
      )
    ) or (
      status<>'confirmed_posted_manual' and (posted_by is not null or posted_at is not null or posted_confirmation is true or final_post_url is not null or final_post_url_skip_reason is not null or proof_screenshot_storage_key is not null)
    )
  ) then
    raise exception 'TASK18_EXISTING_COMPLETION_ROWS_INCOMPATIBLE';
  end if;
end $$;

alter table public.creator_publishing_queue_tasks drop constraint if exists creator_publishing_queue_confirmed_requires_url_or_skip;
alter table public.creator_publishing_queue_tasks drop constraint if exists task18_queue_manual_completion_invariants;
alter table public.creator_publishing_queue_tasks add constraint task18_queue_manual_completion_invariants check (
  (status='confirmed_posted_manual' and posted_by is not null and posted_at is not null and posted_confirmation is true and operator_progress_state='handoff_ready' and length(btrim(coalesce(proof_screenshot_storage_key,''))) > 0 and proof_screenshot_storage_key like 'operator-completion-evidence/%' and (
          (
            final_post_url is not null
            and length(btrim(final_post_url)) > 0
            and final_post_url ~ '^https://onlyfans\.com/[0-9]+/[A-Za-z0-9._-]+$'
            and final_post_url_skip_reason is null
          )
          or
          (
            final_post_url is null
            and final_post_url_skip_reason is not null
            and final_post_url_skip_reason in ('platform_did_not_expose_stable_url','post_completed_without_shareable_url','account_owner_declined_url_capture')
          )
        ) is true and skip_or_fail_reason is null and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null)
  or
  (status<>'confirmed_posted_manual' and posted_by is null and posted_at is null and posted_confirmation is false and final_post_url is null and final_post_url_skip_reason is null and proof_screenshot_storage_key is null)
);

alter table public.creator_publishing_operator_action_idempotency add column if not exists internal_request_snapshot jsonb;
alter table public.creator_publishing_operator_action_idempotency drop constraint if exists creator_publishing_operator_action_idempotenc_action_type_check;
alter table public.creator_publishing_operator_action_idempotency drop constraint if exists creator_publishing_operator_action_idempotency_action_type_check;
alter table public.creator_publishing_operator_action_idempotency drop constraint if exists task18_operator_action_type_check;
alter table public.creator_publishing_operator_action_idempotency add constraint task18_operator_action_type_check check (
  action_type in (
    'claim',
    'release',
    'progress_update',
    'expired_claim_recovery',
    'manual_completion'
  )
);

create table if not exists public.creator_publishing_operator_completion_evidence_intents (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  queue_task_id uuid not null references public.creator_publishing_queue_tasks(id) on delete cascade,
  platform_job_id uuid not null references public.creator_publishing_platform_jobs(id) on delete cascade,
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  platform_account_id uuid not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,160}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  claim_fingerprint text not null check (claim_fingerprint ~ '^[a-f0-9]{64}$'),
  operation text not null check (operation in ('create','replace')),
  replaces_intent_id uuid references public.creator_publishing_operator_completion_evidence_intents(id),
  replaced_by_intent_id uuid references public.creator_publishing_operator_completion_evidence_intents(id),
  server_bucket text not null check (server_bucket='operator-completion-evidence'),
  server_path text not null check (server_path like 'operator-completion-evidence/%'),
  expected_mime_type text not null check (expected_mime_type in ('image/jpeg','image/png','image/webp')),
  expected_size_bytes integer not null check (expected_size_bytes between 1 and 10485760),
  normalized_mime_type text,
  actual_size_bytes integer,
  verified_sha256 text,
  status text not null default 'pending' check (status in ('pending','verified','invalidated','consumed','failed','expired')),
  intent_expires_at timestamptz not null,
  credential_signing_started_at timestamptz,
  last_credential_issued_at timestamptz,
  last_credential_expires_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task18_evidence_storage_key unique(server_bucket, server_path),
  constraint task18_evidence_actor_job_request unique(actor_id, platform_job_id, request_key),
  constraint task18_evidence_verified_metadata check ((status in ('verified','consumed') and normalized_mime_type in ('image/jpeg','image/png','image/webp') and actual_size_bytes between 1 and 10485760 and verified_sha256 ~ '^[0-9a-f]{64}$' and verified_at is not null) or status not in ('verified','consumed')),
  constraint task18_evidence_consumed_at check ((status='consumed') = (consumed_at is not null)),
  constraint task18_evidence_invalidated_at check ((status='invalidated') = (invalidated_at is not null)),
  constraint task18_evidence_failed_at check ((status='failed') = (failed_at is not null)),
  constraint task18_evidence_failure_code check ((status='failed' and failure_code in ('download_missing','oversized_image','malformed_image','mime_or_size_mismatch','storage_unavailable')) or (status<>'failed' and failure_code is null)),
  constraint task18_evidence_expired_at check ((status='expired') = (expired_at is not null))
);
create unique index if not exists task18_one_active_evidence_intent on public.creator_publishing_operator_completion_evidence_intents(actor_id,platform_job_id,claim_fingerprint) where status in ('pending','verified');
alter table public.creator_publishing_operator_completion_evidence_intents enable row level security;
revoke all on public.creator_publishing_operator_completion_evidence_intents from public, anon, authenticated;
grant select, insert, update, delete on public.creator_publishing_operator_completion_evidence_intents to service_role;

create or replace function public.task18_claim_fingerprint(p_queue_task_id uuid,p_claim_token uuid) returns text language sql immutable set search_path=public,pg_catalog as $$ select encode(extensions.digest(p_queue_task_id::text||':'||p_claim_token::text,'sha256'),'hex') $$;
create or replace function public.task18_safe_completion_result(p_platform_job_id uuid,p_final_url text,p_reason text,p_idempotent boolean) returns jsonb language sql immutable set search_path=public,pg_catalog as $$ select jsonb_build_object('platform_job_id',p_platform_job_id,'status','confirmed_posted_manual','final_post_url',p_final_url,'final_post_url_skip_reason',p_reason,'idempotent',p_idempotent) $$;
create or replace function public.task18_canonical_onlyfans_url(p_url text,p_username text) returns text language plpgsql immutable set search_path=public,pg_catalog as $$ declare m text[]; begin if p_url is null then return null; end if; m:=regexp_match(p_url,'^https://(www\.)?onlyfans\.com/([0-9]+)/([A-Za-z0-9._-]+)$'); if m is null or m[3]<>p_username then raise exception 'INVALID_ONLYFANS_URL'; end if; return 'https://onlyfans.com/'||m[2]||'/'||m[3]; end $$;

create or replace function public.task18_current_safety_gate(p_job public.creator_publishing_platform_jobs,p_task public.creator_publishing_queue_tasks,p_actor_id uuid) returns text language plpgsql stable set search_path=public,pg_catalog as $$
declare consent_rec public.creator_publishing_ai_twin_consents%rowtype;
begin
  select * into consent_rec from public.creator_publishing_ai_twin_consents where creator_id=p_job.creator_id;
  if not found then return 'AI_TWIN_CONSENT_MISSING'; end if;
  return public.creator_publishing_operator_current_safety_gate(p_job,p_task,p_actor_id,consent_rec.attestation_version,consent_rec.attestation_text_sha256);
end $$;

create or replace function public.task18_evidence_prevent_terminal_reopen() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if old.status in ('consumed','invalidated','failed','expired') and new.status is distinct from old.status then
    raise exception 'EVIDENCE_TERMINAL_STATUS_IMMUTABLE';
  end if;
  if old.actor_id<>new.actor_id or old.creator_id<>new.creator_id or old.queue_task_id<>new.queue_task_id or old.platform_job_id<>new.platform_job_id or old.content_package_id<>new.content_package_id or old.platform_account_id<>new.platform_account_id or old.request_key<>new.request_key or old.request_fingerprint<>new.request_fingerprint or old.claim_fingerprint<>new.claim_fingerprint or old.server_bucket<>new.server_bucket or old.server_path<>new.server_path then
    raise exception 'EVIDENCE_IMMUTABLE_FIELD_CHANGED';
  end if;
  if old.verified_at is not null and (old.normalized_mime_type is distinct from new.normalized_mime_type or old.actual_size_bytes is distinct from new.actual_size_bytes or old.verified_sha256 is distinct from new.verified_sha256 or old.verified_at is distinct from new.verified_at) then
    raise exception 'EVIDENCE_VERIFIED_METADATA_IMMUTABLE';
  end if;
  return new;
end $$;

drop trigger if exists task18_evidence_prevent_terminal_reopen_trg on public.creator_publishing_operator_completion_evidence_intents;
create trigger task18_evidence_prevent_terminal_reopen_trg before update on public.creator_publishing_operator_completion_evidence_intents for each row execute function public.task18_evidence_prevent_terminal_reopen();

create or replace function public.creator_publishing_reserve_completion_evidence_intent(p_actor_id uuid,p_platform_job_id uuid,p_operation text,p_request_key text,p_expected_mime_type text,p_expected_size_bytes int,p_replaces_upload_intent_id uuid,p_server_bucket text,p_server_path text,p_intent_expires_at timestamptz,p_credential_signing_started_at timestamptz) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare plan_rec public.creator_publishing_plans%rowtype; job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; existing public.creator_publishing_operator_completion_evidence_intents%rowtype; old_intent public.creator_publishing_operator_completion_evidence_intents%rowtype; claim_fp text; req_fp text; new_id uuid; max_expires timestamptz; db_intent_expires_at timestamptz; begin
  perform pg_advisory_xact_lock(hashtextextended('task18-intent:'||p_actor_id||':'||p_platform_job_id||':'||p_request_key,0));
  select p.* into plan_rec from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update;
  perform 1 from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  perform 1 from public.creator_publishing_content_packages where id=job.content_package_id for update;
  perform 1 from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  if not found or task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_expires_at<=now() or task.operator_progress_state<>'handoff_ready' then raise exception 'CURRENT_CLAIM_REQUIRED'; end if;
  if public.task18_current_safety_gate(job,task,p_actor_id) is not null then raise exception 'WORK_NOT_COMPLETABLE'; end if;
  db_intent_expires_at:=task.claim_expires_at - interval '5 seconds'; if db_intent_expires_at<=now() then raise exception 'CURRENT_CLAIM_REQUIRED'; end if;
  claim_fp:=public.task18_claim_fingerprint(task.id,task.claim_token);
  -- Expire every active intent for this actor/job/claim before request-key idempotency lookup.
  -- This releases task18_one_active_evidence_intent for a new lifecycle key while preserving
  -- same-key terminal replay of the expired row below.
  perform 1 from public.creator_publishing_operator_completion_evidence_intents
    where actor_id=p_actor_id and platform_job_id=p_platform_job_id and claim_fingerprint=claim_fp
      and status in ('pending','verified')
    order by id for update;
  update public.creator_publishing_operator_completion_evidence_intents
    set status='expired', expired_at=coalesce(expired_at,now()), updated_at=now()
    where actor_id=p_actor_id and platform_job_id=p_platform_job_id and claim_fingerprint=claim_fp
      and status in ('pending','verified') and intent_expires_at<=now();
  req_fp:=encode(extensions.digest(jsonb_build_object('operation',p_operation,'mime',p_expected_mime_type,'size',p_expected_size_bytes,'claim',claim_fp,'replace',p_replaces_upload_intent_id)::text,'sha256'),'hex');
  select * into existing from public.creator_publishing_operator_completion_evidence_intents where actor_id=p_actor_id and platform_job_id=p_platform_job_id and request_key=p_request_key for update;
  if found then
    if existing.request_fingerprint<>req_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if existing.status in ('pending','verified') and existing.intent_expires_at<=now() then
      update public.creator_publishing_operator_completion_evidence_intents set status='expired',expired_at=now(),updated_at=now() where id=existing.id returning * into existing;
      return jsonb_build_object('upload_intent_id',existing.id,'server_bucket',existing.server_bucket,'server_path',existing.server_path,'status','expired','intent_expires_at',existing.intent_expires_at);
    end if;
    if existing.status <> 'pending' or existing.intent_expires_at<=now() then return jsonb_build_object('upload_intent_id',existing.id,'server_bucket',existing.server_bucket,'server_path',existing.server_path,'status',existing.status,'intent_expires_at',existing.intent_expires_at); end if;
    max_expires:=greatest(coalesce(existing.last_credential_expires_at,'epoch'::timestamptz),p_credential_signing_started_at + interval '2 hours 5 minutes');
    update public.creator_publishing_operator_completion_evidence_intents set credential_signing_started_at=p_credential_signing_started_at,last_credential_issued_at=greatest(coalesce(existing.last_credential_issued_at,'epoch'::timestamptz),p_credential_signing_started_at),last_credential_expires_at=max_expires,updated_at=now() where id=existing.id returning * into existing;
    return jsonb_build_object('upload_intent_id',existing.id,'server_bucket',existing.server_bucket,'server_path',existing.server_path,'status',existing.status,'intent_expires_at',existing.intent_expires_at);
  end if;
  if (select count(*) from public.creator_publishing_operator_completion_evidence_intents where actor_id=p_actor_id and platform_job_id=p_platform_job_id and claim_fingerprint=claim_fp) >= 3 then raise exception 'EVIDENCE_REPLACEMENT_LIMIT_REACHED'; end if;
  if p_operation='replace' then
    select * into old_intent from public.creator_publishing_operator_completion_evidence_intents where id=p_replaces_upload_intent_id and actor_id=p_actor_id and platform_job_id=p_platform_job_id and queue_task_id=task.id and claim_fingerprint=claim_fp and status in ('pending','verified') for update;
    if not found then raise exception 'EVIDENCE_REPLACEMENT_TARGET_INVALID'; end if;
    update public.creator_publishing_operator_completion_evidence_intents set status='invalidated', invalidated_at=now(), updated_at=now() where id=old_intent.id;
  end if;
  insert into public.creator_publishing_operator_completion_evidence_intents(actor_id,creator_id,queue_task_id,platform_job_id,content_package_id,platform_account_id,request_key,request_fingerprint,claim_fingerprint,operation,replaces_intent_id,server_bucket,server_path,expected_mime_type,expected_size_bytes,intent_expires_at,credential_signing_started_at,last_credential_issued_at,last_credential_expires_at) values(p_actor_id,job.creator_id,task.id,job.id,job.content_package_id,job.platform_account_id,p_request_key,req_fp,claim_fp,p_operation,p_replaces_upload_intent_id,p_server_bucket,p_server_path,p_expected_mime_type,p_expected_size_bytes,db_intent_expires_at,p_credential_signing_started_at,p_credential_signing_started_at,p_credential_signing_started_at + interval '2 hours 5 minutes') returning id into new_id;
  if p_replaces_upload_intent_id is not null then update public.creator_publishing_operator_completion_evidence_intents set replaced_by_intent_id=new_id where id=p_replaces_upload_intent_id; end if;
  return jsonb_build_object('upload_intent_id',new_id,'server_bucket',p_server_bucket,'server_path',p_server_path,'status','pending','intent_expires_at',db_intent_expires_at);
end $$;

create or replace function public.creator_publishing_prepare_completion_evidence_verification(p_actor_id uuid,p_platform_job_id uuid,p_upload_intent_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$ declare job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; r public.creator_publishing_operator_completion_evidence_intents%rowtype; begin
  perform pg_advisory_xact_lock(hashtextextended('task18-verify:'||p_actor_id||':'||p_upload_intent_id,0));
  perform 1 from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update;
  perform 1 from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  perform 1 from public.creator_publishing_content_packages where id=job.content_package_id for update;
  perform 1 from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  select * into r from public.creator_publishing_operator_completion_evidence_intents where id=p_upload_intent_id and actor_id=p_actor_id and platform_job_id=p_platform_job_id and queue_task_id=task.id for update;
  if task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_expires_at<=now() or r.claim_fingerprint<>public.task18_claim_fingerprint(task.id,task.claim_token) or public.task18_current_safety_gate(job,task,p_actor_id) is not null or not found or r.status<>'pending' or r.intent_expires_at<=now() then raise exception 'EVIDENCE_NOT_PENDING'; end if;
  return jsonb_build_object('server_bucket',r.server_bucket,'server_path',r.server_path,'expected_mime_type',r.expected_mime_type,'expected_size_bytes',r.expected_size_bytes);
end $$;

create or replace function public.creator_publishing_verify_completion_evidence_intent(p_actor_id uuid,p_platform_job_id uuid,p_upload_intent_id uuid,p_normalized_mime_type text,p_actual_size_bytes int,p_verified_sha256 text) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$ declare job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; r public.creator_publishing_operator_completion_evidence_intents%rowtype; begin
  perform pg_advisory_xact_lock(hashtextextended('task18-verify-save:'||p_actor_id||':'||p_upload_intent_id,0));
  perform 1 from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update;
  perform 1 from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  perform 1 from public.creator_publishing_content_packages where id=job.content_package_id for update;
  perform 1 from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  select * into r from public.creator_publishing_operator_completion_evidence_intents where id=p_upload_intent_id and actor_id=p_actor_id and platform_job_id=p_platform_job_id and queue_task_id=task.id for update;
  if task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_expires_at<=now() or r.claim_fingerprint<>public.task18_claim_fingerprint(task.id,task.claim_token) or public.task18_current_safety_gate(job,task,p_actor_id) is not null or not found or r.status<>'pending' or r.intent_expires_at<=now() or r.expected_mime_type<>p_normalized_mime_type or r.expected_size_bytes<>p_actual_size_bytes then raise exception 'EVIDENCE_VERIFY_FAILED'; end if;
  update public.creator_publishing_operator_completion_evidence_intents set status='verified',normalized_mime_type=p_normalized_mime_type,actual_size_bytes=p_actual_size_bytes,verified_sha256=p_verified_sha256,verified_at=now(),updated_at=now() where id=r.id;
  return jsonb_build_object('ok',true);
end $$;


create or replace function public.creator_publishing_fail_completion_evidence_intent(p_actor_id uuid,p_platform_job_id uuid,p_upload_intent_id uuid,p_failure_code text) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$ declare job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; r public.creator_publishing_operator_completion_evidence_intents%rowtype; safe_code text; begin
  safe_code:=case when p_failure_code in ('download_missing','oversized_image','malformed_image','mime_or_size_mismatch','storage_unavailable') then p_failure_code else 'malformed_image' end;
  perform pg_advisory_xact_lock(hashtextextended('task18-verify-fail:'||p_actor_id||':'||p_upload_intent_id,0));
  perform 1 from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update;
  perform 1 from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  perform 1 from public.creator_publishing_content_packages where id=job.content_package_id for update;
  perform 1 from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  select * into r from public.creator_publishing_operator_completion_evidence_intents where id=p_upload_intent_id and actor_id=p_actor_id and platform_job_id=p_platform_job_id and queue_task_id=task.id for update;
  if not found or task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_expires_at<=now() or r.claim_fingerprint<>public.task18_claim_fingerprint(task.id,task.claim_token) or public.task18_current_safety_gate(job,task,p_actor_id) is not null or r.status<>'pending' or r.intent_expires_at<=now() then raise exception 'EVIDENCE_NOT_PENDING'; end if;
  update public.creator_publishing_operator_completion_evidence_intents set status='failed',failed_at=now(),failure_code=safe_code,updated_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'status','failed');
end $$;

create or replace function public.creator_publishing_cleanup_failed_completion_evidence(p_limit int default 25) returns table(upload_intent_id uuid, server_bucket text, server_path text) language sql security definer set search_path=public,pg_catalog as $$
  select id, server_bucket, server_path from public.creator_publishing_operator_completion_evidence_intents
  where status='failed' and last_credential_expires_at is not null and last_credential_expires_at<=now()
  order by failed_at nulls last, id limit greatest(1,least(coalesce(p_limit,25),100));
$$;

create or replace function public.creator_publishing_prepare_manual_completion_fresh_verification(p_actor_id uuid,p_platform_job_id uuid,p_evidence_intent_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$ declare job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; r public.creator_publishing_operator_completion_evidence_intents%rowtype; begin
  perform pg_advisory_xact_lock(hashtextextended('task18-fresh:'||p_actor_id||':'||p_evidence_intent_id,0));
  perform 1 from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update;
  perform 1 from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  perform 1 from public.creator_publishing_content_packages where id=job.content_package_id for update;
  perform 1 from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  select * into r from public.creator_publishing_operator_completion_evidence_intents where id=p_evidence_intent_id and actor_id=p_actor_id and platform_job_id=p_platform_job_id and queue_task_id=task.id for update;
  if task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_expires_at<=now() or r.claim_fingerprint<>public.task18_claim_fingerprint(task.id,task.claim_token) or public.task18_current_safety_gate(job,task,p_actor_id) is not null or not found or r.status<>'verified' or r.intent_expires_at<=now() then raise exception 'EVIDENCE_NOT_VERIFIED'; end if;
  return jsonb_build_object('server_bucket',r.server_bucket,'server_path',r.server_path,'claim_token',task.claim_token);
end $$;

create or replace function public.creator_publishing_complete_onlyfans_manual_post(p_mode text,p_actor_id uuid,p_platform_job_id uuid,p_idempotency_key text,p_evidence_intent_id uuid,p_final_post_url text default null,p_final_post_url_skip_reason text default null,p_verified_sha256 text default null,p_actual_size_bytes int default null,p_normalized_mime_type text default null,p_claim_token uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare idem public.creator_publishing_operator_action_idempotency%rowtype; plan_rec public.creator_publishing_plans%rowtype; job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; acct public.creator_platform_accounts%rowtype; pkg public.creator_publishing_content_packages%rowtype; cap public.creator_publishing_platform_capabilities%rowtype; ev public.creator_publishing_operator_completion_evidence_intents%rowtype; fp text; result jsonb; canon text; v_now timestamptz:=now(); begin
  perform pg_advisory_xact_lock(hashtextextended('task18-complete:'||p_actor_id||':'||p_idempotency_key,0));
  fp:=encode(extensions.digest(jsonb_build_object('actor',p_actor_id,'job',p_platform_job_id,'url',p_final_post_url,'reason',p_final_post_url_skip_reason,'evidence',p_evidence_intent_id)::text,'sha256'),'hex');
  select * into idem from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='manual_completion' and idempotency_key=p_idempotency_key for update;
  if found then if idem.request_fingerprint<>fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; if p_mode='complete' and idem.internal_request_snapshot is not null and (idem.internal_request_snapshot->>'verified_sha256' is distinct from p_verified_sha256 or (idem.internal_request_snapshot->>'actual_size_bytes')::int is distinct from p_actual_size_bytes or idem.internal_request_snapshot->>'normalized_mime_type' is distinct from p_normalized_mime_type) then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return idem.stored_result || jsonb_build_object('replayed',true,'idempotent',true); end if;
  if p_mode='replay_probe' then return jsonb_build_object('replayed',false); end if;
  select p.* into plan_rec from public.creator_publishing_plans p join public.creator_publishing_platform_jobs j on j.publishing_plan_id=p.id where j.id=p_platform_job_id for update of p;
  select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  perform 1 from public.creator_publishing_scheduler_events where platform_job_id=job.id and status in ('pending','processing') order by id for update;
  select * into cap from public.creator_publishing_platform_capabilities where platform=job.target_platform for update;
  select * into pkg from public.creator_publishing_content_packages where id=job.content_package_id for update;
  select * into acct from public.creator_platform_accounts where id=job.platform_account_id for update;
  perform 1 from public.creator_publishing_creator_verifications where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_operator_authorizations where creator_id=job.creator_id and operator_id=p_actor_id order by id for update;
  perform 1 from public.creator_publishing_ai_twin_consents where creator_id=job.creator_id for update;
  perform 1 from public.creator_publishing_compliance_reviews where content_package_id=job.content_package_id order by created_at,id for update;
  perform 1 from public.creator_publishing_co_performer_records where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_media_assets where content_package_id=job.content_package_id order by id for update;
  perform 1 from public.creator_publishing_platform_jobs where content_package_id=job.content_package_id and id<>job.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by id for update;
  select * into task from public.creator_publishing_queue_tasks where content_package_id=job.content_package_id and creator_id=job.creator_id and platform_account_id=job.platform_account_id and target_platform=job.target_platform and status='claimed' for update;
  select * into ev from public.creator_publishing_operator_completion_evidence_intents where id=p_evidence_intent_id for update;
  if job.target_platform<>'onlyfans' or job.publishing_mode<>'assisted' or job.cancelled_at is not null or job.job_state in ('confirmed_posted_manual','published_direct','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') then raise exception 'WORK_NOT_COMPLETABLE'; end if;
  if public.task18_current_safety_gate(job,task,p_actor_id) is not null then raise exception 'WORK_NOT_COMPLETABLE'; end if;
  if task.claimed_by is distinct from p_actor_id or task.claim_token is null or task.claim_token is distinct from p_claim_token or task.claim_expires_at<=v_now or task.operator_progress_state<>'handoff_ready' then raise exception 'CURRENT_CLAIM_REQUIRED'; end if;
  if acct.platform<>'onlyfans' or acct.creator_id<>job.creator_id or acct.verification_status<>'verified' then raise exception 'ACCOUNT_NOT_VERIFIED'; end if;
  if pkg.creator_approval_status<>'approved' or pkg.compliance_status not in ('passed','escalated_approved') then raise exception 'PACKAGE_NOT_APPROVED'; end if;
  if cap.availability_status<>'available' or cap.human_operator_queue_supported is not true or cap.human_publishing_required is not true then raise exception 'CAPABILITY_UNAVAILABLE'; end if;
  if not public.creator_publishing_job_source_is_current(job.id) then raise exception 'SOURCE_CHANGED'; end if;
  if ev.status<>'verified' or ev.actor_id<>p_actor_id or ev.platform_job_id<>job.id or ev.queue_task_id<>task.id or ev.claim_fingerprint<>public.task18_claim_fingerprint(task.id,task.claim_token) or ev.verified_sha256<>p_verified_sha256 or ev.actual_size_bytes<>p_actual_size_bytes or ev.normalized_mime_type<>p_normalized_mime_type then raise exception 'EVIDENCE_MISMATCH'; end if;
  if p_final_post_url is not null then
    if length(btrim(p_final_post_url)) = 0 or p_final_post_url_skip_reason is not null then
      raise exception 'URL_OR_REASON_REQUIRED';
    end if;
    canon:=public.task18_canonical_onlyfans_url(p_final_post_url,acct.platform_username);
  else
    if p_final_post_url_skip_reason is null or p_final_post_url_skip_reason not in ('platform_did_not_expose_stable_url','post_completed_without_shareable_url','account_owner_declined_url_capture') then
      raise exception 'URL_OR_REASON_REQUIRED';
    end if;
    canon:=null;
  end if;
  update public.creator_publishing_queue_tasks set status='confirmed_posted_manual',posted_by=p_actor_id,posted_at=v_now,posted_confirmation=true,final_post_url=canon,final_post_url_skip_reason=p_final_post_url_skip_reason,proof_screenshot_storage_key=ev.server_path,claimed_by=null,claimed_at=null,claim_token=null,claim_expires_at=null,skip_or_fail_reason=null,updated_at=v_now where id=task.id;
  update public.creator_publishing_platform_jobs set job_state='confirmed_posted_manual',updated_at=v_now where id=job.id;
  update public.creator_publishing_operator_completion_evidence_intents set status='consumed',consumed_at=v_now,updated_at=v_now where id=ev.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) select 'creator_publishing_scheduler_event',se.id,p_actor_id,'operator','operator_onlyfans_manual_completion_scheduler_superseded',jsonb_build_object('status',se.status),jsonb_build_object('status','superseded'),p_idempotency_key,v_now from public.creator_publishing_scheduler_events se where se.platform_job_id=job.id and se.status in ('pending','processing');
  update public.creator_publishing_scheduler_events set status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,updated_at=v_now where platform_job_id=job.id and status in ('pending','processing');
  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(plan_rec.id),updated_at=v_now where id=plan_rec.id;
  result:=public.task18_safe_completion_result(job.id,canon,p_final_post_url_skip_reason,false);
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values
    ('creator_publishing_queue_task',task.id,p_actor_id,'operator','operator_onlyfans_manual_completion',jsonb_build_object('status',task.status),jsonb_build_object('status','confirmed_posted_manual'),p_idempotency_key,v_now),
    ('creator_publishing_platform_job',job.id,p_actor_id,'operator','operator_onlyfans_manual_completion',jsonb_build_object('job_state',job.job_state),jsonb_build_object('job_state','confirmed_posted_manual'),p_idempotency_key,v_now),
    ('creator_publishing_plan',plan_rec.id,p_actor_id,'operator','operator_onlyfans_manual_completion_plan_recomputed',jsonb_build_object('status',plan_rec.status),jsonb_build_object('status',public.creator_publishing_aggregate_plan_status(plan_rec.id)),p_idempotency_key,v_now);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,stored_result,internal_request_snapshot,created_at) values(p_actor_id,job.creator_id,task.id,job.id,'manual_completion',p_idempotency_key,fp,result,jsonb_build_object('platform_job_id',job.id,'final_post_url',canon,'final_post_url_skip_reason',p_final_post_url_skip_reason,'evidence_intent_id',ev.id,'verified_sha256',p_verified_sha256,'actual_size_bytes',p_actual_size_bytes,'normalized_mime_type',p_normalized_mime_type),v_now);
  return result;
end $$;

revoke execute on function public.task18_claim_fingerprint(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.task18_safe_completion_result(uuid,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.task18_canonical_onlyfans_url(text,text) from public, anon, authenticated;
revoke execute on function public.task18_current_safety_gate(public.creator_publishing_platform_jobs,public.creator_publishing_queue_tasks,uuid) from public, anon, authenticated;
revoke execute on function public.task18_evidence_prevent_terminal_reopen() from public, anon, authenticated;
revoke execute on function public.creator_publishing_reserve_completion_evidence_intent(uuid,uuid,text,text,text,int,uuid,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.creator_publishing_prepare_completion_evidence_verification(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.creator_publishing_verify_completion_evidence_intent(uuid,uuid,uuid,text,int,text) from public, anon, authenticated;
revoke execute on function public.creator_publishing_fail_completion_evidence_intent(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.creator_publishing_cleanup_failed_completion_evidence(int) from public, anon, authenticated;
revoke execute on function public.creator_publishing_prepare_manual_completion_fresh_verification(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.creator_publishing_complete_onlyfans_manual_post(text,uuid,uuid,text,uuid,text,text,text,int,text,uuid) from public, anon, authenticated;
grant execute on function public.task18_claim_fingerprint(uuid,uuid) to service_role;
grant execute on function public.task18_safe_completion_result(uuid,text,text,boolean) to service_role;
grant execute on function public.task18_canonical_onlyfans_url(text,text) to service_role;
grant execute on function public.task18_current_safety_gate(public.creator_publishing_platform_jobs,public.creator_publishing_queue_tasks,uuid) to service_role;
grant execute on function public.creator_publishing_reserve_completion_evidence_intent(uuid,uuid,text,text,text,int,uuid,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.creator_publishing_prepare_completion_evidence_verification(uuid,uuid,uuid) to service_role;
grant execute on function public.creator_publishing_verify_completion_evidence_intent(uuid,uuid,uuid,text,int,text) to service_role;
grant execute on function public.creator_publishing_fail_completion_evidence_intent(uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_cleanup_failed_completion_evidence(int) to service_role;
grant execute on function public.creator_publishing_prepare_manual_completion_fresh_verification(uuid,uuid,uuid) to service_role;
grant execute on function public.creator_publishing_complete_onlyfans_manual_post(text,uuid,uuid,text,uuid,text,text,text,int,text,uuid) to service_role;
commit;
