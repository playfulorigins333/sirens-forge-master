-- PFC-CORE-03C: manual PRE-03100 targeted recovery capture.
-- Run only as the database owner, immediately before 03100, and only after the
-- separately managed full database dump has been verified.
begin;

do $guard$
declare n text;
begin
  if current_user <> 'postgres' then
    raise exception 'PFC03100_BACKUP_REQUIRES_POSTGRES_OWNER';
  end if;
  foreach n in array array[
    'pfc03100_backup_payment_v2_holds','pfc03100_backup_payment_v2_purchases',
    'pfc03100_backup_payment_v2_reconciliation_evidence','pfc03100_backup_affiliate_ledger',
    'pfc03100_backup_catalog_snapshot','pfc03100_backup_manifest'
  ] loop
    if pg_catalog.to_regclass('public.' || n) is not null then
      raise exception 'PFC03100_BACKUP_SET_ALREADY_EXISTS: public.%', n;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.payment_v2_acquire_hold(bytea,text,timestamptz)') is null
     or pg_catalog.to_regprocedure('public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz)') is null
     or pg_catalog.to_regprocedure('public.payment_v2_acquire_hold(bytea,text,timestamptz,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema='public'
                and table_name='payment_v2_holds' and column_name='referral_code_id') then
    raise exception 'PFC03100_NOT_PRE_MIGRATION_SCHEMA';
  end if;
end
$guard$;

lock table public.payment_v2_holds, public.payment_v2_purchases,
  public.payment_v2_reconciliation_evidence, public.affiliate_ledger
  in access exclusive mode;

create table public.pfc03100_backup_payment_v2_holds as table public.payment_v2_holds;
create table public.pfc03100_backup_payment_v2_purchases as table public.payment_v2_purchases;
create table public.pfc03100_backup_payment_v2_reconciliation_evidence as table public.payment_v2_reconciliation_evidence;
create table public.pfc03100_backup_affiliate_ledger as table public.affiliate_ledger;

create table public.pfc03100_backup_catalog_snapshot (
  object_kind text not null,
  object_identity text not null,
  metadata jsonb not null,
  primary key (object_kind, object_identity)
);

-- One structured row per table captures columns, constraints, indexes, RLS,
-- owner and expanded ACLs.  Definitions are server-generated, not hand copied.
insert into public.pfc03100_backup_catalog_snapshot
select 'table', c.oid::regclass::text,
  jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
    'columns', (select jsonb_agg(jsonb_build_object(
       'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
       'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),
       'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d
        on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object(
       'name',x.conname,'type',x.contype,'definition',pg_catalog.pg_get_constraintdef(x.oid,true))
       order by x.conname),'[]'::jsonb) from pg_catalog.pg_constraint x where x.conrelid=c.oid),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
       'name',i.relname,'definition',pg_catalog.pg_get_indexdef(i.oid)) order by i.relname),'[]'::jsonb)
       from pg_catalog.pg_index ix join pg_catalog.pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
    'acl', (select coalesce(jsonb_agg(jsonb_build_object(
       'grantee',case when e.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(e.grantee) end,
       'privilege',e.privilege_type,'grantable',e.is_grantable) order by e.grantee,e.privilege_type),'[]'::jsonb)
       from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) e),
    'column_acl', (select coalesce(jsonb_agg(jsonb_build_object(
       'column',a.attname,'grantee',case when e.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(e.grantee) end,
       'privilege',e.privilege_type,'grantable',e.is_grantable) order by a.attnum,e.grantee,e.privilege_type),'[]'::jsonb)
       from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) e
       where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null)
  )
from pg_catalog.pg_class c
where c.oid = any(array['public.payment_v2_holds'::regclass,
 'public.payment_v2_purchases'::regclass,'public.payment_v2_reconciliation_evidence'::regclass,
 'public.affiliate_ledger'::regclass]);

-- 03100 drops/replaces the first two functions and materially replaces the
-- remaining three.  Preserve executable server definitions and all attributes.
insert into public.pfc03100_backup_catalog_snapshot
select 'function', p.oid::regprocedure::text,
 jsonb_build_object('identity_arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
   'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef,'proconfig',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object(
      'grantee',case when e.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(e.grantee) end,
      'privilege',e.privilege_type,'grantable',e.is_grantable) order by e.grantee,e.privilege_type),'[]'::jsonb)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) e))
from pg_catalog.pg_proc p
where p.oid = any(array[
 'public.payment_v2_acquire_hold(bytea,text,timestamptz)'::regprocedure,
 'public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz)'::regprocedure,
 'public.payment_v2_claim(uuid,bytea,uuid,uuid)'::regprocedure,
 'public.release_affiliate_commissions()'::regprocedure,
 'public.create_affiliate_payout_batch(text)'::regprocedure]);

create table public.pfc03100_backup_manifest (
  backup_identifier text primary key,
  created_at timestamptz not null,
  database_name text not null,
  postgres_version text not null,
  expected_migration_filename text not null,
  expected_migration_sha256 text not null,
  source_counts jsonb not null,
  backup_counts jsonb not null
);
insert into public.pfc03100_backup_manifest values (
 'PRE-03100',clock_timestamp(),current_database(),version(),
 '20260807003100_payment_v2_affiliate_attribution.sql',
 '1a3cf2e2ca71056f2ed6b8412208fbedf06b4a1d9605dfc2bb53efe87548b7cf',
 jsonb_build_object('payment_v2_holds',(select count(*) from public.payment_v2_holds),
  'payment_v2_purchases',(select count(*) from public.payment_v2_purchases),
  'payment_v2_reconciliation_evidence',(select count(*) from public.payment_v2_reconciliation_evidence),
  'affiliate_ledger',(select count(*) from public.affiliate_ledger)),
 jsonb_build_object('payment_v2_holds',(select count(*) from public.pfc03100_backup_payment_v2_holds),
  'payment_v2_purchases',(select count(*) from public.pfc03100_backup_payment_v2_purchases),
  'payment_v2_reconciliation_evidence',(select count(*) from public.pfc03100_backup_payment_v2_reconciliation_evidence),
  'affiliate_ledger',(select count(*) from public.pfc03100_backup_affiliate_ledger))
);

do $verify$
begin
 if (select source_counts <> backup_counts from public.pfc03100_backup_manifest where backup_identifier='PRE-03100')
    or (select count(*) from public.pfc03100_backup_catalog_snapshot where object_kind='table') <> 4
    or (select count(*) from public.pfc03100_backup_catalog_snapshot where object_kind='function') <> 5 then
   raise exception 'PFC03100_BACKUP_VERIFICATION_FAILED';
 end if;
end
$verify$;

alter table public.pfc03100_backup_payment_v2_holds enable row level security;
alter table public.pfc03100_backup_payment_v2_purchases enable row level security;
alter table public.pfc03100_backup_payment_v2_reconciliation_evidence enable row level security;
alter table public.pfc03100_backup_affiliate_ledger enable row level security;
alter table public.pfc03100_backup_catalog_snapshot enable row level security;
alter table public.pfc03100_backup_manifest enable row level security;
revoke all on table public.pfc03100_backup_payment_v2_holds,
 public.pfc03100_backup_payment_v2_purchases,
 public.pfc03100_backup_payment_v2_reconciliation_evidence,
 public.pfc03100_backup_affiliate_ledger,
 public.pfc03100_backup_catalog_snapshot,
 public.pfc03100_backup_manifest from public, anon, authenticated, service_role;

commit;
