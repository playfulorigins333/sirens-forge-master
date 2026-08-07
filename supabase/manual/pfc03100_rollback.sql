-- PFC-CORE-03C: immediate PRE-CUTOVER rollback of an applied 03100.
-- This intentionally retains every pfc03100_backup_* artifact.
begin;

do $guard$
declare n text;
begin
 if current_user <> 'postgres' then raise exception 'PFC03100_ROLLBACK_REQUIRES_POSTGRES_OWNER'; end if;
 foreach n in array array[
  'pfc03100_backup_payment_v2_holds','pfc03100_backup_payment_v2_purchases',
  'pfc03100_backup_payment_v2_reconciliation_evidence','pfc03100_backup_affiliate_ledger',
  'pfc03100_backup_catalog_snapshot','pfc03100_backup_manifest'
 ] loop
  if pg_catalog.to_regclass('public.'||n) is null then
   raise exception 'PFC03100_INCOMPLETE_BACKUP_PACKAGE: public.%',n;
  end if;
 end loop;
 if not exists(select 1 from public.pfc03100_backup_manifest
   where backup_identifier='PRE-03100'
   and expected_migration_filename='20260807003100_payment_v2_affiliate_attribution.sql'
   and expected_migration_sha256='1a3cf2e2ca71056f2ed6b8412208fbedf06b4a1d9605dfc2bb53efe87548b7cf'
   and source_counts=backup_counts)
   or (select count(*) from public.pfc03100_backup_catalog_snapshot where object_kind='table')<>4
   or (select count(*) from public.pfc03100_backup_catalog_snapshot where object_kind='function')<>5 then
  raise exception 'PFC03100_BACKUP_PACKAGE_VERIFICATION_FAILED';
 end if;
 if pg_catalog.to_regprocedure('public.payment_v2_acquire_hold(bytea,text,timestamptz,text)') is null
    or pg_catalog.to_regprocedure('public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
                  and table_name='payment_v2_holds' and column_name='referral_code_id') then
  raise exception 'PFC03100_NOT_APPLIED_SCHEMA';
 end if;
end
$guard$;

lock table public.payment_v2_holds, public.payment_v2_purchases,
 public.payment_v2_reconciliation_evidence, public.affiliate_ledger
 in access exclusive mode;

-- 03100 makes no data rewrite.  Compare every PRE-03100 value in both
-- directions, excluding only columns introduced by 03100.  Any new row,
-- deletion, or material update aborts before a schema/function change.
do $drift$
begin
 -- 03100 performs no backfill.  Consequently every 03100-only value on a row
 -- that existed at backup time must remain NULL.  Checking this separately is
 -- essential: projecting the new columns away only proves the old values did
 -- not change and would otherwise permit attributed state to be discarded.
 if exists(select 1 from public.payment_v2_holds x
   join public.pfc03100_backup_payment_v2_holds b using(id)
   where x.referral_code_id is not null or x.referrer_auth_user_id is not null
      or x.referrer_profile_id is not null or x.referrer_affiliate_tier is not null
      or x.referral_bound_at is not null or x.stripe_connect_destination is not null)
   then raise exception 'PFC03100_UNSAFE_DRIFT: payment_v2_holds 03100-only state'; end if;
 if exists(select 1 from public.payment_v2_purchases x
   join public.pfc03100_backup_payment_v2_purchases b using(id)
   where x.referral_code_id is not null or x.referrer_auth_user_id is not null
      or x.referrer_profile_id is not null or x.referrer_affiliate_tier is not null
      or x.referral_bound_at is not null or x.gross_amount_cents is not null
      or x.currency is not null)
   then raise exception 'PFC03100_UNSAFE_DRIFT: payment_v2_purchases 03100-only state'; end if;
 if exists(select 1 from public.affiliate_ledger x
   join public.pfc03100_backup_affiliate_ledger b using(id)
   where x.payment_v2_purchase_id is not null or x.referral_code_id is not null
      or x.referrer_affiliate_tier is not null or x.attribution_status is not null
      or x.void_reason is not null or x.voided_at is not null)
   then raise exception 'PFC03100_UNSAFE_DRIFT: affiliate_ledger 03100-only state'; end if;
 if exists(
   (select to_jsonb(x)-array['referral_code_id','referrer_auth_user_id','referrer_profile_id','referrer_affiliate_tier','referral_bound_at','stripe_connect_destination'] from public.payment_v2_holds x
    except select to_jsonb(b) from public.pfc03100_backup_payment_v2_holds b)
   union all
   (select to_jsonb(b) from public.pfc03100_backup_payment_v2_holds b
    except select to_jsonb(x)-array['referral_code_id','referrer_auth_user_id','referrer_profile_id','referrer_affiliate_tier','referral_bound_at','stripe_connect_destination'] from public.payment_v2_holds x)
 ) then raise exception 'PFC03100_UNSAFE_DRIFT: payment_v2_holds'; end if;
 if exists(
   (select to_jsonb(x)-array['referral_code_id','referrer_auth_user_id','referrer_profile_id','referrer_affiliate_tier','referral_bound_at','gross_amount_cents','currency'] from public.payment_v2_purchases x
    except select to_jsonb(b) from public.pfc03100_backup_payment_v2_purchases b)
   union all
   (select to_jsonb(b) from public.pfc03100_backup_payment_v2_purchases b
    except select to_jsonb(x)-array['referral_code_id','referrer_auth_user_id','referrer_profile_id','referrer_affiliate_tier','referral_bound_at','gross_amount_cents','currency'] from public.payment_v2_purchases x)
 ) then raise exception 'PFC03100_UNSAFE_DRIFT: payment_v2_purchases'; end if;
 if exists((select to_jsonb(x) from public.payment_v2_reconciliation_evidence x except select to_jsonb(b) from public.pfc03100_backup_payment_v2_reconciliation_evidence b)
   union all (select to_jsonb(b) from public.pfc03100_backup_payment_v2_reconciliation_evidence b except select to_jsonb(x) from public.payment_v2_reconciliation_evidence x))
   then raise exception 'PFC03100_UNSAFE_DRIFT: payment_v2_reconciliation_evidence'; end if;
 if exists(
   (select to_jsonb(x)-array['payment_v2_purchase_id','referral_code_id','referrer_affiliate_tier','attribution_status','void_reason','voided_at'] from public.affiliate_ledger x
    except select to_jsonb(b) from public.pfc03100_backup_affiliate_ledger b)
   union all
   (select to_jsonb(b) from public.pfc03100_backup_affiliate_ledger b
    except select to_jsonb(x)-array['payment_v2_purchase_id','referral_code_id','referrer_affiliate_tier','attribution_status','void_reason','voided_at'] from public.affiliate_ledger x)
 ) then raise exception 'PFC03100_UNSAFE_DRIFT: affiliate_ledger'; end if;
end
$drift$;

drop function public.payment_v2_acquire_hold(bytea,text,timestamptz,text);
drop function public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text);

alter table public.payment_v2_reconciliation_evidence
 drop constraint payment_v2_evidence_kind,
 drop constraint payment_v2_evidence_provider,
 drop constraint payment_v2_evidence_purchase,
 drop constraint payment_v2_evidence_session;
alter table public.payment_v2_reconciliation_evidence
 add constraint payment_v2_reconciliation_evidence_event_kind_check check (event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID','CLAIMED')),
 add constraint payment_v2_reconciliation_evidence_check check ((event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID') and provider_event_id is not null) or (event_kind='CLAIMED' and provider_event_id is null)),
 add constraint payment_v2_reconciliation_evidence_check1 check ((event_kind in ('PAYMENT_CONFIRMED','CLAIMED'))=(purchase_id is not null)),
 add constraint payment_v2_reconciliation_evidence_check2 check ((event_kind='CLAIMED' and stripe_checkout_session_id is null) or (event_kind<>'CLAIMED' and btrim(coalesce(stripe_checkout_session_id,''))<>''));

drop index public.affiliate_ledger_one_payment_v2_obligation;
alter table public.affiliate_ledger
 drop constraint affiliate_ledger_payment_v2_attribution,
 drop constraint affiliate_ledger_payment_v2_void,
 alter column referred_user_id set not null,
 drop column payment_v2_purchase_id,
 drop column referral_code_id,
 drop column referrer_affiliate_tier,
 drop column attribution_status,
 drop column void_reason,
 drop column voided_at;
alter table public.payment_v2_purchases
 drop constraint payment_v2_purchase_referral_tuple,
 drop constraint payment_v2_verified_money,
 drop column referral_code_id,
 drop column referrer_auth_user_id,
 drop column referrer_profile_id,
 drop column referrer_affiliate_tier,
 drop column referral_bound_at,
 drop column gross_amount_cents,
 drop column currency;
alter table public.payment_v2_holds
 drop constraint payment_v2_hold_referral_tuple,
 drop column referral_code_id,
 drop column referrer_auth_user_id,
 drop column referrer_profile_id,
 drop column referrer_affiliate_tier,
 drop column referral_bound_at,
 drop column stripe_connect_destination;

-- Restore the five authoritative PRE-03100 server definitions captured before
-- cutover.  pg_get_functiondef includes language, body, volatility, SECURITY
-- mode and SET configuration; owner and ACL are restored separately below.
drop function if exists public.payment_v2_acquire_hold(bytea,text,timestamptz);
drop function if exists public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz);
drop function public.payment_v2_claim(uuid,bytea,uuid,uuid);
drop function public.release_affiliate_commissions();
drop function public.create_affiliate_payout_batch(text);
do $functions$
declare f record; a record;
begin
 for f in select object_identity,metadata from public.pfc03100_backup_catalog_snapshot
          where object_kind='function' order by object_identity loop
  execute f.metadata->>'definition';
  execute format('alter function %s owner to %I',f.object_identity,f.metadata->>'owner');
  execute format('revoke all privileges on function %s from public, anon, authenticated, service_role',f.object_identity);
  for a in select * from jsonb_to_recordset(f.metadata->'acl')
      as x(grantee text,privilege text,grantable boolean) loop
   if a.grantee <> f.metadata->>'owner' then
    execute format('grant %s on function %s to %s%s',a.privilege,f.object_identity,
      case when a.grantee='PUBLIC' then 'PUBLIC' else quote_ident(a.grantee) end,
      case when a.grantable then ' with grant option' else '' end);
   end if;
  end loop;
 end loop;
end
$functions$;

-- 03100 changes affiliate_ledger's service_role grants.  Remove every direct
-- role/column grant it could have left, then replay the PRE-03100 snapshot.
do $table_acl$
declare t record; a record; col record;
begin
 for t in select object_identity,metadata from public.pfc03100_backup_catalog_snapshot where object_kind='table' loop
  execute format('alter table %s owner to %I',t.object_identity,t.metadata->>'owner');
  execute format('alter table %s %s row level security',t.object_identity,case when (t.metadata->>'rls_enabled')::boolean then 'enable' else 'disable' end);
  execute format('alter table %s %s force row level security',t.object_identity,case when (t.metadata->>'rls_forced')::boolean then '' else 'no' end);
  execute format('revoke all privileges on table %s from public, anon, authenticated, service_role',t.object_identity);
  for col in select value->>'name' name from jsonb_array_elements(t.metadata->'columns') loop
   execute format('revoke select (%I), insert (%I), update (%I), references (%I) on table %s from public, anon, authenticated, service_role',col.name,col.name,col.name,col.name,t.object_identity);
  end loop;
  for a in select * from jsonb_to_recordset(t.metadata->'acl') as x(grantee text,privilege text,grantable boolean) loop
   if a.grantee <> t.metadata->>'owner' then execute format('grant %s on table %s to %s%s',a.privilege,t.object_identity,case when a.grantee='PUBLIC' then 'PUBLIC' else quote_ident(a.grantee) end,case when a.grantable then ' with grant option' else '' end); end if;
  end loop;
  for a in select * from jsonb_to_recordset(t.metadata->'column_acl') as x("column" text,grantee text,privilege text,grantable boolean) loop
   execute format('grant %s (%I) on table %s to %s%s',a.privilege,a."column",t.object_identity,case when a.grantee='PUBLIC' then 'PUBLIC' else quote_ident(a.grantee) end,case when a.grantable then ' with grant option' else '' end);
  end loop;
 end loop;
end
$table_acl$;

select pg_notify('pgrst','reload schema');
commit;
