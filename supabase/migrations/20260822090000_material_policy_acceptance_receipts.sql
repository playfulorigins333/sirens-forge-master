-- Additive, dormant-until-called material-policy receipt store. Applying this
-- migration alone changes no checkout, entitlement, or existing application path.
create table public.material_policy_acceptance_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('payment_first_checkout','authenticated_reconsent')),
  auth_user_id uuid references auth.users(id),
  profile_id uuid references public.profiles(id),
  payment_v2_hold_id uuid references public.payment_v2_holds(id),
  material_bundle_version text not null check (btrim(material_bundle_version) <> ''),
  terms_version text not null check (btrim(terms_version) <> ''),
  privacy_version text not null check (btrim(privacy_version) <> ''),
  acceptable_use_version text not null check (btrim(acceptable_use_version) <> ''),
  acceptance_statement_version text not null check (btrim(acceptance_statement_version) <> ''),
  source_revision text not null check (btrim(source_revision) <> ''),
  bundle_source_sha256 text not null check (bundle_source_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (accepted_at = created_at),
  check ((source='authenticated_reconsent' and auth_user_id is not null and profile_id is not null and payment_v2_hold_id is null)
      or (source='payment_first_checkout' and auth_user_id is null and profile_id is null and payment_v2_hold_id is not null))
);
create unique index material_policy_receipt_authenticated_bundle
  on public.material_policy_acceptance_receipts(auth_user_id, material_bundle_version) where auth_user_id is not null;
create unique index material_policy_receipt_checkout_bundle
  on public.material_policy_acceptance_receipts(payment_v2_hold_id, material_bundle_version) where payment_v2_hold_id is not null;
alter table public.material_policy_acceptance_receipts enable row level security;

create function public.material_policy_receipts_are_immutable() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$ begin raise exception 'material_policy_receipts_are_immutable'; end $$;
create trigger material_policy_receipts_reject_update_delete before update or delete on public.material_policy_acceptance_receipts
for each row execute function public.material_policy_receipts_are_immutable();

create function public.record_authenticated_material_policy_acceptance(
 p_auth_user_id uuid,p_material_bundle_version text,p_terms_version text,p_privacy_version text,p_acceptable_use_version text,
 p_acceptance_statement_version text,p_source_revision text,p_bundle_source_sha256 text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_profile uuid; v_id uuid;
begin
 if p_auth_user_id is null then raise exception 'unauthenticated'; end if;
 if (p_material_bundle_version,p_terms_version,p_privacy_version,p_acceptable_use_version,p_acceptance_statement_version,p_source_revision,p_bundle_source_sha256)
    is distinct from ('material-policy-2026-08-22-r1','terms-2026-08-22-r1','privacy-2026-08-22-r1','acceptable-use-2026-08-22-r1','material-policy-acceptance-2026-08-22-r1','policy-source-2026-08-22-r1','fac8d21b3a1f62eba47c01a32b84a7b492e5a2b4f21f5be86669a6eb4f7b23a3') then raise exception 'material_policy_manifest_mismatch'; end if;
 select id into v_profile from public.profiles where user_id=p_auth_user_id;
 if v_profile is null then raise exception 'profile_not_found'; end if;
 insert into public.material_policy_acceptance_receipts(source,auth_user_id,profile_id,material_bundle_version,terms_version,privacy_version,acceptable_use_version,acceptance_statement_version,source_revision,bundle_source_sha256)
 values('authenticated_reconsent',p_auth_user_id,v_profile,p_material_bundle_version,p_terms_version,p_privacy_version,p_acceptable_use_version,p_acceptance_statement_version,p_source_revision,p_bundle_source_sha256)
 on conflict(auth_user_id,material_bundle_version) where auth_user_id is not null do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.material_policy_acceptance_receipts where auth_user_id=p_auth_user_id and material_bundle_version=p_material_bundle_version; end if;
 return v_id;
end $$;

create function public.record_payment_first_material_policy_acceptance(
 p_hold_id uuid,p_purchaser_hash bytea,p_material_bundle_version text,p_terms_version text,p_privacy_version text,p_acceptable_use_version text,
 p_acceptance_statement_version text,p_source_revision text,p_bundle_source_sha256 text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid;
begin
 if octet_length(p_purchaser_hash)<>32 or not exists(select 1 from public.payment_v2_holds where id=p_hold_id and purchaser_credential_hash=p_purchaser_hash) then raise exception 'hold_mismatch'; end if;
 if (p_material_bundle_version,p_terms_version,p_privacy_version,p_acceptable_use_version,p_acceptance_statement_version,p_source_revision,p_bundle_source_sha256)
    is distinct from ('material-policy-2026-08-22-r1','terms-2026-08-22-r1','privacy-2026-08-22-r1','acceptable-use-2026-08-22-r1','material-policy-acceptance-2026-08-22-r1','policy-source-2026-08-22-r1','fac8d21b3a1f62eba47c01a32b84a7b492e5a2b4f21f5be86669a6eb4f7b23a3') then raise exception 'material_policy_manifest_mismatch'; end if;
 insert into public.material_policy_acceptance_receipts(source,payment_v2_hold_id,material_bundle_version,terms_version,privacy_version,acceptable_use_version,acceptance_statement_version,source_revision,bundle_source_sha256)
 values('payment_first_checkout',p_hold_id,p_material_bundle_version,p_terms_version,p_privacy_version,p_acceptable_use_version,p_acceptance_statement_version,p_source_revision,p_bundle_source_sha256)
 on conflict(payment_v2_hold_id,material_bundle_version) where payment_v2_hold_id is not null do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.material_policy_acceptance_receipts where payment_v2_hold_id=p_hold_id and material_bundle_version=p_material_bundle_version; end if;
 return v_id;
end $$;

revoke all on table public.material_policy_acceptance_receipts from public,anon,authenticated;
grant select on table public.material_policy_acceptance_receipts to service_role;
revoke all on function public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text) to service_role;
revoke all on function public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text) to service_role;
