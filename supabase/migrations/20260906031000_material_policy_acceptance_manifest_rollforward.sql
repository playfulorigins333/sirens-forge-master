-- Hotfix: keep database-enforced material-policy receipt validation aligned with
-- the current application manifest. This migration does not mutate existing
-- receipts, checkout holds, purchases, subscriptions, or entitlements.
-- Production application requires separate explicit authorization.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('public.material_policy_acceptance_receipts') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.payment_v2_holds') is null
     or to_regprocedure('public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text)') is null
  then
    raise exception 'MATERIAL_POLICY_ACCEPTANCE_PREREQUISITE_MISSING';
  end if;
end
$preflight$;

create or replace function public.record_authenticated_material_policy_acceptance(
  p_auth_user_id uuid,
  p_material_bundle_version text,
  p_terms_version text,
  p_privacy_version text,
  p_acceptable_use_version text,
  p_acceptance_statement_version text,
  p_source_revision text,
  p_bundle_source_sha256 text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_profile uuid;
  v_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if (
    p_material_bundle_version,
    p_terms_version,
    p_privacy_version,
    p_acceptable_use_version,
    p_acceptance_statement_version,
    p_source_revision,
    p_bundle_source_sha256
  ) is distinct from (
    'material-policy-2026-09-05-r1',
    'terms-2026-09-05-r1',
    'privacy-2026-09-05-r1',
    'acceptable-use-2026-08-22-r1',
    'material-policy-acceptance-2026-09-05-r1',
    'policy-source-2026-09-05-r1',
    '595ae993a8dab470851a849578fae424efdeddf512be44346397b6777dca6be0'
  ) then
    raise exception 'material_policy_manifest_mismatch';
  end if;

  select id into v_profile
  from public.profiles
  where user_id = p_auth_user_id;

  if v_profile is null then
    raise exception 'profile_not_found';
  end if;

  insert into public.material_policy_acceptance_receipts(
    source,
    auth_user_id,
    profile_id,
    material_bundle_version,
    terms_version,
    privacy_version,
    acceptable_use_version,
    acceptance_statement_version,
    source_revision,
    bundle_source_sha256
  ) values (
    'authenticated_reconsent',
    p_auth_user_id,
    v_profile,
    p_material_bundle_version,
    p_terms_version,
    p_privacy_version,
    p_acceptable_use_version,
    p_acceptance_statement_version,
    p_source_revision,
    p_bundle_source_sha256
  )
  on conflict(auth_user_id,material_bundle_version)
    where auth_user_id is not null
    do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.material_policy_acceptance_receipts
    where auth_user_id = p_auth_user_id
      and material_bundle_version = p_material_bundle_version;
  end if;

  return v_id;
end
$$;

create or replace function public.record_payment_first_material_policy_acceptance(
  p_hold_id uuid,
  p_purchaser_hash bytea,
  p_material_bundle_version text,
  p_terms_version text,
  p_privacy_version text,
  p_acceptable_use_version text,
  p_acceptance_statement_version text,
  p_source_revision text,
  p_bundle_source_sha256 text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_id uuid;
begin
  if octet_length(p_purchaser_hash) <> 32
     or not exists (
       select 1
       from public.payment_v2_holds
       where id = p_hold_id
         and purchaser_credential_hash = p_purchaser_hash
     ) then
    raise exception 'hold_mismatch';
  end if;

  if (
    p_material_bundle_version,
    p_terms_version,
    p_privacy_version,
    p_acceptable_use_version,
    p_acceptance_statement_version,
    p_source_revision,
    p_bundle_source_sha256
  ) is distinct from (
    'material-policy-2026-09-05-r1',
    'terms-2026-09-05-r1',
    'privacy-2026-09-05-r1',
    'acceptable-use-2026-08-22-r1',
    'material-policy-acceptance-2026-09-05-r1',
    'policy-source-2026-09-05-r1',
    '595ae993a8dab470851a849578fae424efdeddf512be44346397b6777dca6be0'
  ) then
    raise exception 'material_policy_manifest_mismatch';
  end if;

  insert into public.material_policy_acceptance_receipts(
    source,
    payment_v2_hold_id,
    material_bundle_version,
    terms_version,
    privacy_version,
    acceptable_use_version,
    acceptance_statement_version,
    source_revision,
    bundle_source_sha256
  ) values (
    'payment_first_checkout',
    p_hold_id,
    p_material_bundle_version,
    p_terms_version,
    p_privacy_version,
    p_acceptable_use_version,
    p_acceptance_statement_version,
    p_source_revision,
    p_bundle_source_sha256
  )
  on conflict(payment_v2_hold_id,material_bundle_version)
    where payment_v2_hold_id is not null
    do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.material_policy_acceptance_receipts
    where payment_v2_hold_id = p_hold_id
      and material_bundle_version = p_material_bundle_version;
  end if;

  return v_id;
end
$$;

revoke all on function public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text)
  to service_role;

revoke all on function public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text)
  to service_role;

commit;
