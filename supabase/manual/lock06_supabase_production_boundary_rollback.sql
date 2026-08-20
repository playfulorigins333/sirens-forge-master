-- EMERGENCY MANUAL ROLLBACK ONLY.
-- This rollback deliberately reopens legacy browser/API exposure and restores broad future-object defaults.
-- Run only after a fresh backup and explicit human approval.
-- Never run automatically. This file is source-only preparation until a separately authorized Production gate.

begin;

do $lock06_rollback_pre$
declare
  v_sale oid := to_regclass('public.sale_counters');
  v_muses oid := to_regclass('public.muses');
  v_trigger_fn oid := to_regprocedure('public.record_lora_terminal_status()');
  v_public_default_execute boolean;
  v_bad boolean := false;
begin
  select exists (
    select 1
    from pg_roles r
    left join pg_default_acl d
      on d.defaclrole=r.oid
     and d.defaclnamespace=0
     and d.defaclobjtype='f'
    cross join lateral aclexplode(coalesce(d.defaclacl, acldefault('f', r.oid))) a
    where r.rolname='postgres' and a.grantee=0 and a.privilege_type='EXECUTE'
  ) into v_public_default_execute;

  v_bad := v_bad or v_public_default_execute;

  v_bad := v_bad or v_sale is null
    or not exists(select 1 from pg_class c where c.oid=v_sale and c.relkind='v' and coalesce(c.reloptions,'{}'::text[]) @> array['security_invoker=true'])
    or has_table_privilege('anon',v_sale,'SELECT') or has_table_privilege('authenticated',v_sale,'SELECT')
    or not has_table_privilege('service_role',v_sale,'SELECT');
  v_bad := v_bad or v_muses is null
    or has_table_privilege('anon',v_muses,'SELECT') or has_table_privilege('authenticated',v_muses,'SELECT')
    or exists(select 1 from pg_policy where polrelid=v_muses);
  v_bad := v_bad or v_trigger_fn is null
    or not exists(select 1 from pg_proc where oid=v_trigger_fn and proconfig=array['search_path=pg_catalog, pg_temp']::text[]);
  if v_bad then raise exception using errcode='P0001', message='LOCK06_ROLLBACK_DRIFT'; end if;
end
$lock06_rollback_pre$;

alter view public.sale_counters reset (security_invoker);
grant select on public.sale_counters to anon, authenticated;

grant all privileges on table public.muses to anon, authenticated;
create policy "public read muses" on public.muses for select using (true);

alter function public.record_lora_terminal_status() reset search_path;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges for role postgres
  grant execute on functions to public;

do $lock06_rollback_post$
declare
  v_sale oid := to_regclass('public.sale_counters');
  v_muses oid := to_regclass('public.muses');
  v_trigger_fn oid := to_regprocedure('public.record_lora_terminal_status()');
  v_public_default_execute boolean;
  v_bad boolean := false;
begin
  select exists (
    select 1
    from pg_roles r
    left join pg_default_acl d
      on d.defaclrole=r.oid
     and d.defaclnamespace=0
     and d.defaclobjtype='f'
    cross join lateral aclexplode(coalesce(d.defaclacl, acldefault('f', r.oid))) a
    where r.rolname='postgres' and a.grantee=0 and a.privilege_type='EXECUTE'
  ) into v_public_default_execute;

  v_bad := v_bad or not v_public_default_execute;

  v_bad := v_bad or v_sale is null
    or not exists(select 1 from pg_class c where c.oid=v_sale and c.relkind='v' and not (coalesce(c.reloptions,'{}'::text[]) @> array['security_invoker=true']))
    or not has_table_privilege('anon',v_sale,'SELECT') or not has_table_privilege('authenticated',v_sale,'SELECT')
    or not has_table_privilege('service_role',v_sale,'SELECT');
  v_bad := v_bad or v_muses is null
    or not has_table_privilege('anon',v_muses,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not has_table_privilege('authenticated',v_muses,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not has_table_privilege('service_role',v_muses,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or (select count(*) from pg_policy where polrelid=v_muses)<>1
    or not exists(select 1 from pg_policy where polrelid=v_muses and polname='public read muses' and polcmd='r' and pg_get_expr(polqual,polrelid)='true');
  v_bad := v_bad or v_trigger_fn is null or not exists(select 1 from pg_proc where oid=v_trigger_fn and proconfig is null);
  if v_bad then raise exception using errcode='P0001', message='LOCK06_ROLLBACK_POSTCONDITION_FAILED'; end if;
end
$lock06_rollback_post$;

commit;
