begin;

-- Production drift repair for the Phase 7 -> Phase 9 account-deletion
-- notification handoff. The current Phase 7 source contains these columns, but
-- the migration already applied to Production predates that source correction.
-- This migration deliberately sorts immediately before the Phase 9 outbox
-- migration so both Production and fresh ordered replays have the same contract.
alter table public.account_deletion_requests
  add column if not exists requested_notification_due_at timestamptz,
  add column if not exists reactivated_notification_due_at timestamptz,
  add column if not exists completed_notification_due_at timestamptz;

-- Keep the notification handoff correct even on installations whose already-
-- applied Phase 7 request/reactivation functions do not yet write the newer
-- account_deletion_requests marker columns. Current source already supplies the
-- values explicitly; these guards only fill a missing marker from authoritative
-- lifecycle timestamps.
create or replace function public.phase9_repair_account_deletion_notification_due()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.requested_notification_due_at is null and new.requested_at is not null then
    new.requested_notification_due_at := new.requested_at;
  end if;

  if new.reactivated_notification_due_at is null and new.reactivated_at is not null then
    new.reactivated_notification_due_at := new.reactivated_at;
  end if;

  return new;
end
$$;

drop trigger if exists phase9_repair_account_deletion_notification_due
  on public.account_deletion_requests;
create trigger phase9_repair_account_deletion_notification_due
before insert or update of
  requested_at,
  reactivated_at,
  requested_notification_due_at,
  reactivated_notification_due_at
on public.account_deletion_requests
for each row
execute function public.phase9_repair_account_deletion_notification_due();

-- Preserve historical truth without fabricating send/delivery evidence.
update public.account_deletion_requests
set requested_notification_due_at = requested_at
where requested_notification_due_at is null
  and requested_at is not null;

update public.account_deletion_requests
set reactivated_notification_due_at = reactivated_at
where reactivated_notification_due_at is null
  and reactivated_at is not null;

alter function public.phase9_repair_account_deletion_notification_due() owner to postgres;
revoke all on function public.phase9_repair_account_deletion_notification_due()
  from public, anon, authenticated, service_role;

select pg_notify('pgrst','reload schema');
commit;
