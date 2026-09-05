-- Phase 7 closeout: fail closed when a recoverable recurring subscription has
-- not been set to cancel before voluntary account deletion.
-- Existing Phase 7 migrations are immutable; this is additive hardening only.

begin;

create or replace function public.phase7_guard_account_deletion_recurring_billing()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'pending' and exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = new.profile_id
      and s.stripe_subscription_id is not null
      and lower(btrim(s.status)) in ('active','trialing','past_due','unpaid')
      and coalesce(s.cancel_at_period_end,false) = false
  ) then
    raise exception 'ACCOUNT_DELETION_BILLING_ACTIVE';
  end if;
  return new;
end $$;

revoke all on function public.phase7_guard_account_deletion_recurring_billing() from public, anon, authenticated;

drop trigger if exists trg_phase7_account_deletion_recurring_billing on public.account_deletion_requests;
create trigger trg_phase7_account_deletion_recurring_billing
before insert on public.account_deletion_requests
for each row execute function public.phase7_guard_account_deletion_recurring_billing();

commit;
