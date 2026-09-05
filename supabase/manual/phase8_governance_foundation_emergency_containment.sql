-- PHASE 8A GOVERNANCE FOUNDATION: EMERGENCY MANUAL CONTAINMENT / ROLLBACK GATE.
-- Requires explicit human authorization and a fresh Production backup/snapshot.
-- Never run automatically.
--
-- The Phase 8A migration is transactional. If application fails before COMMIT,
-- PostgreSQL rollback is authoritative and this file is not needed.
--
-- If the migration committed and an incident is attributable to Phase 8A, this
-- file performs the safest first rollback step: it removes service_role access
-- to the new Phase 8A entry points and readable governance tables while
-- preserving all governance evidence in place.
--
-- This file is intentionally NON-DESTRUCTIVE. Never DROP, TRUNCATE, DELETE, or
-- rewrite governance audit, receipt, retention, or legal-hold evidence as an
-- emergency rollback. Any later structural reversal must be a separately
-- reviewed and separately authorized forward migration after proving that no
-- protected evidence would be lost.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'phase8_governance_containment_requires_postgres';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260905060000'
  ) then
    raise exception 'phase8_governance_foundation_not_recorded';
  end if;

  if to_regclass('public.retention_policy_versions') is null
     or to_regclass('public.governance_audit_events') is null
     or to_regclass('public.governance_action_receipts') is null
     or to_regclass('public.governance_legal_holds') is null
     or to_regclass('public.governance_legal_hold_targets') is null then
    raise exception 'phase8_governance_foundation_objects_missing';
  end if;
end
$$;

revoke execute on function public.current_retention_policy(text,timestamptz) from service_role;
revoke execute on function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) from service_role;
revoke execute on function public.record_governance_action_receipt(text,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,uuid,text) from service_role;
revoke execute on function public.open_governance_legal_hold(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,text,jsonb,uuid,text) from service_role;
revoke execute on function public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text) from service_role;
revoke execute on function public.governance_target_has_active_legal_hold(text,text,uuid) from service_role;

revoke select on table public.retention_policy_versions from service_role;
revoke select on table public.governance_action_receipts from service_role;
revoke select on table public.governance_legal_holds from service_role;
revoke select on table public.governance_legal_hold_targets from service_role;

commit;
