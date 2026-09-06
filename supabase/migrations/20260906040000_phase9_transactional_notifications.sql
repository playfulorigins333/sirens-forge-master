begin;

-- Phase 9: transactional notification outbox. This migration only materializes
-- authoritative Phase 7 due markers; it never fabricates historical delivery.
create table public.transactional_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('creator_data_export','account_deletion','subscription_cancellation','payment_delinquency')),
  source_id uuid not null,
  notification_kind text not null check (notification_kind in (
    'export_ready','deletion_requested','deletion_reactivated','deletion_completed',
    'cancellation_day_0','cancellation_day_30','cancellation_day_45','cancellation_day_55',
    'delinquency_day_0','delinquency_day_30','delinquency_day_45','delinquency_day_55')),
  -- Evidence must not prevent the authoritative account-deletion lifecycle from
  -- removing auth.users. Recipient resolution still fails closed against Auth.
  auth_user_id uuid not null,
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','claimed','delivered','retry','suppressed','failed_uncertain')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_attempt_started_at timestamptz,
  delivered_at timestamptz,
  terminal_reason text check (terminal_reason is null or terminal_reason in ('source_stale','ownership_mismatch','recipient_missing','recipient_invalid','attempts_exhausted','provider_outcome_uncertain','provider_permanent')),
  provider_message_id_hash text check (provider_message_id_hash is null or provider_message_id_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(source_type, source_id, notification_kind),
  check ((state='claimed') = (lease_token is not null and lease_expires_at is not null)),
  check ((state='delivered') = (delivered_at is not null))
);
create index transactional_notifications_claim_idx on public.transactional_notification_deliveries(next_attempt_at, due_at) where state in ('pending','retry','claimed');
alter table public.transactional_notification_deliveries enable row level security;
alter table public.transactional_notification_deliveries force row level security;
revoke all on public.transactional_notification_deliveries from public, anon, authenticated, service_role;
-- Deliberately no direct-table grant: service_role uses bounded SECURITY DEFINER RPCs.

create function public.materialize_phase9_notifications(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer;
begin
  if p_limit not between 1 and 500 then raise exception 'notification_limit_invalid'; end if;
  with candidates as (
    select 'creator_data_export'::text source_type,id source_id,'export_ready'::text kind,auth_user_id,ready_notification_due_at due_at
      from public.creator_data_exports where ready_notification_due_at<=clock_timestamp() and auth_user_id is not null
    union all select 'account_deletion',id,'deletion_requested',auth_user_id,requested_notification_due_at from public.account_deletion_requests where requested_notification_due_at<=clock_timestamp() and auth_user_id is not null
    union all select 'account_deletion',id,'deletion_reactivated',auth_user_id,reactivated_notification_due_at from public.account_deletion_requests where reactivated_notification_due_at<=clock_timestamp() and auth_user_id is not null
    union all select 'account_deletion',id,'deletion_completed',auth_user_id,completed_notification_due_at from public.account_deletion_requests where completed_notification_due_at<=clock_timestamp() and auth_user_id is not null
    union all select 'subscription_cancellation',id,'cancellation_day_0',auth_user_id,day_0_notification_due_at from public.subscription_cancellation_retentions where day_0_notification_due_at<=clock_timestamp()
    union all select 'subscription_cancellation',id,'cancellation_day_30',auth_user_id,day_30_notification_due_at from public.subscription_cancellation_retentions where day_30_notification_due_at<=clock_timestamp()
    union all select 'subscription_cancellation',id,'cancellation_day_45',auth_user_id,day_45_notification_due_at from public.subscription_cancellation_retentions where day_45_notification_due_at<=clock_timestamp()
    union all select 'subscription_cancellation',id,'cancellation_day_55',auth_user_id,day_55_notification_due_at from public.subscription_cancellation_retentions where day_55_notification_due_at<=clock_timestamp()
    union all select 'payment_delinquency',id,'delinquency_day_0',auth_user_id,day_0_notification_due_at from public.subscription_payment_delinquencies where day_0_notification_due_at<=clock_timestamp()
    union all select 'payment_delinquency',id,'delinquency_day_30',auth_user_id,day_30_notification_due_at from public.subscription_payment_delinquencies where day_30_notification_due_at<=clock_timestamp()
    union all select 'payment_delinquency',id,'delinquency_day_45',auth_user_id,day_45_notification_due_at from public.subscription_payment_delinquencies where day_45_notification_due_at<=clock_timestamp()
    union all select 'payment_delinquency',id,'delinquency_day_55',auth_user_id,day_55_notification_due_at from public.subscription_payment_delinquencies where day_55_notification_due_at<=clock_timestamp()
  ), unmaterialized as (
    select c.* from candidates c
    where c.due_at is not null and not exists (
      select 1 from public.transactional_notification_deliveries n
      where n.source_type=c.source_type and n.source_id=c.source_id and n.notification_kind=c.kind
    )
  ), chosen as (select * from unmaterialized order by due_at,source_type,source_id,kind limit p_limit), inserted as (
    insert into public.transactional_notification_deliveries(source_type,source_id,notification_kind,auth_user_id,due_at,next_attempt_at)
    select source_type,source_id,kind,auth_user_id,due_at,due_at from chosen on conflict do nothing returning 1)
  select count(*) into v_count from inserted; return v_count;
end $$;

create function public.claim_phase9_notifications(p_lease_token uuid,p_limit integer default 25)
returns table(id uuid,source_type text,source_id uuid,notification_kind text,auth_user_id uuid,due_at timestamptz,attempts integer,context jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_lease_token is null or p_limit not between 1 and 50 then raise exception 'notification_claim_invalid'; end if;
 -- Only a claim that reached the provider has an uncertain outcome. Work that
 -- never started transport is safely requeued (or exhausted) instead of lost.
 update public.transactional_notification_deliveries expired set
   state=case when expired.provider_attempt_started_at is not null then 'failed_uncertain' when expired.attempts>=8 then 'suppressed' else 'retry' end,
   terminal_reason=case when expired.provider_attempt_started_at is not null then 'provider_outcome_uncertain' when expired.attempts>=8 then 'attempts_exhausted' end,
   next_attempt_at=case when expired.provider_attempt_started_at is null and expired.attempts<8 then clock_timestamp() else expired.next_attempt_at end,
   lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
 where expired.state='claimed' and expired.lease_expires_at<=clock_timestamp();
 -- Permanently stale lifecycle work is durably suppressed immediately before claim.
 update public.transactional_notification_deliveries n set state='suppressed',terminal_reason='source_stale',updated_at=clock_timestamp()
 where n.state in ('pending','retry') and n.next_attempt_at<=clock_timestamp() and (
  (n.source_type='creator_data_export' and not exists(select 1 from public.creator_data_exports x where x.id=n.source_id and x.auth_user_id=n.auth_user_id and x.status in ('completed','downloaded') and x.ready_notification_due_at=n.due_at and x.expires_at>clock_timestamp())) or
  (n.source_type='account_deletion' and not exists(select 1 from public.account_deletion_requests x where x.id=n.source_id and x.auth_user_id=n.auth_user_id and ((n.notification_kind='deletion_requested' and x.status in ('pending','purge_pending') and x.requested_notification_due_at=n.due_at) or (n.notification_kind='deletion_reactivated' and x.status='reactivated' and x.reactivated_notification_due_at=n.due_at) or (n.notification_kind='deletion_completed' and x.status='completed' and x.completed_notification_due_at=n.due_at)))) or
  (n.source_type='subscription_cancellation' and not exists(select 1 from public.subscription_cancellation_retentions x where x.id=n.source_id and x.auth_user_id=n.auth_user_id and x.state in ('pending_paid_access_end','retained_read_only','expired') and case n.notification_kind when 'cancellation_day_0' then x.day_0_notification_due_at when 'cancellation_day_30' then x.day_30_notification_due_at when 'cancellation_day_45' then x.day_45_notification_due_at else x.day_55_notification_due_at end=n.due_at)) or
  (n.source_type='payment_delinquency' and not exists(select 1 from public.subscription_payment_delinquencies x where x.id=n.source_id and x.auth_user_id=n.auth_user_id and x.state in ('retention_countdown','expired') and case n.notification_kind when 'delinquency_day_0' then x.day_0_notification_due_at when 'delinquency_day_30' then x.day_30_notification_due_at when 'delinquency_day_45' then x.day_45_notification_due_at else x.day_55_notification_due_at end=n.due_at))
 );
 return query with picked as (
  select n.id from public.transactional_notification_deliveries n where n.state in ('pending','retry') and n.attempts<8 and n.next_attempt_at<=clock_timestamp() order by n.due_at for update skip locked limit p_limit
 ), claimed as (update public.transactional_notification_deliveries n set state='claimed',attempts=n.attempts+1,lease_token=p_lease_token,lease_expires_at=clock_timestamp()+interval '10 minutes',provider_attempt_started_at=null,updated_at=clock_timestamp() from picked where n.id=picked.id returning n.*)
 select c.id,c.source_type,c.source_id,c.notification_kind,c.auth_user_id,c.due_at,c.attempts,
 case c.source_type
  when 'creator_data_export' then (select jsonb_build_object('expiresAt',x.expires_at) from public.creator_data_exports x where x.id=c.source_id)
  when 'account_deletion' then (select jsonb_build_object('recoveryDeadline',x.recovery_deadline,'completedAt',x.purge_completed_at) from public.account_deletion_requests x where x.id=c.source_id)
  when 'subscription_cancellation' then (select jsonb_build_object('paidAccessEndsAt',x.paid_access_ends_at,'retentionUntil',x.retention_until) from public.subscription_cancellation_retentions x where x.id=c.source_id)
  else (select jsonb_build_object('retentionStartedAt',x.retention_started_at,'retentionUntil',x.retention_until) from public.subscription_payment_delinquencies x where x.id=c.source_id) end
 from claimed c;
end $$;

create function public.mark_phase9_notification_attempt_started(p_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.transactional_notification_deliveries
 set provider_attempt_started_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and state='claimed' and lease_token=p_lease_token and provider_attempt_started_at is null;
 return found;
end $$;

create function public.finalize_phase9_notification(p_id uuid,p_lease_token uuid,p_outcome text,p_reason text default null,p_provider_message_id_hash text default null)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_attempts integer;
begin
 if p_outcome not in ('delivered','retry','suppressed','failed_uncertain') then raise exception 'notification_outcome_invalid'; end if;
 select attempts into v_attempts from public.transactional_notification_deliveries where id=p_id and state='claimed' and lease_token=p_lease_token for update;
 if not found then return false; end if;
 update public.transactional_notification_deliveries set
  state=case when p_outcome='retry' and v_attempts>=8 then 'suppressed' else p_outcome end,
  delivered_at=case when p_outcome='delivered' then clock_timestamp() end,
  terminal_reason=case when p_outcome='retry' and v_attempts>=8 then 'attempts_exhausted' else p_reason end,
  provider_message_id_hash=case when p_outcome='delivered' then p_provider_message_id_hash end,
  next_attempt_at=case when p_outcome='retry' then clock_timestamp()+make_interval(secs=>least(21600,60*power(2,v_attempts)::integer)) else next_attempt_at end,
  lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_id;
 return true;
end $$;

alter function public.materialize_phase9_notifications(integer) owner to postgres;
alter function public.claim_phase9_notifications(uuid,integer) owner to postgres;
alter function public.mark_phase9_notification_attempt_started(uuid,uuid) owner to postgres;
alter function public.finalize_phase9_notification(uuid,uuid,text,text,text) owner to postgres;
revoke all on function public.materialize_phase9_notifications(integer),public.claim_phase9_notifications(uuid,integer),public.mark_phase9_notification_attempt_started(uuid,uuid),public.finalize_phase9_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.materialize_phase9_notifications(integer),public.claim_phase9_notifications(uuid,integer),public.mark_phase9_notification_attempt_started(uuid,uuid),public.finalize_phase9_notification(uuid,uuid,text,text,text) to service_role;
select pg_notify('pgrst','reload schema');
commit;
