import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const databaseUrl = process.env.LOCK03C2B_DATABASE_URL;
if (!databaseUrl) throw new Error("LOCK03C2B_DATABASE_URL is required; no database was contacted");
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || url.port !== '5432' || url.pathname !== '/lock03c2b_test' || url.search || url.hash) {
  throw new Error("LOCK03C2B safety boundary rejected non-local or unexpected database URL");
}
const migration = readFileSync("supabase/migrations/20260811013000_lock03c2b_function_execution_boundary.sql", "utf8");
const rollback = readFileSync("supabase/manual/lock03c2b_function_execution_boundary_rollback.sql", "utf8");
function psql(sql, expectSuccess = true) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: sql, encoding: "utf8" });
  if ((result.status === 0) !== expectSuccess) throw new Error(`psql expectation failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}
const functionRows = `
  select p.oid::regprocedure::text, owner_role.rolname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '<null>'), md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles owner_role on owner_role.oid=p.proowner
  where n.nspname='public' and (p.proname, oidvectortypes(p.proargtypes)) in
   (('add_tokens','uuid, integer, text'),('deduct_tokens','uuid, integer'),('deduct_tokens','uuid, integer, text'),
    ('record_lora_terminal_status',''),('creator_publishing_platform_account_clear_trusted_metadata','')) order by 1;`;
const triggerRows = `select c.relname, t.tgname, t.tgenabled, p.oid::regprocedure::text, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
  where n.nspname='public' and t.tgname in ('lora_terminal_status_trigger','trg_creator_platform_accounts_clear_trusted_metadata') order by 1;`;
const fixture = `
  drop schema public cascade; create schema public;
  do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    alter role service_role bypassrls;
  end $$;
  grant usage on schema public to anon, authenticated, service_role;
  create function public.add_tokens(p_user_id uuid, p_amount integer, p_purchase_type text) returns void language sql security definer as 'select';
  create function public.deduct_tokens(p_user_id uuid, p_amount integer) returns boolean language sql security definer as 'select true';
  create function public.deduct_tokens(p_user_id uuid, p_amount integer, p_description text) returns boolean language sql security definer as 'select true';
  create table public.user_loras(id integer primary key, status text not null);
  create table public.lora_terminal_events(lora_id integer, marker text);
  create function public.record_lora_terminal_status() returns trigger language plpgsql security definer as $$
    begin if old.status is distinct from new.status then insert into public.lora_terminal_events values(new.id, 'terminal:'||new.status); end if; return new; end $$;
  create trigger lora_terminal_status_trigger after update of status on public.user_loras for each row execute function public.record_lora_terminal_status();
  create table public.creator_platform_accounts(id integer primary key, label text, trusted_metadata text, trigger_marker text);
  create function public.creator_publishing_platform_account_clear_trusted_metadata() returns trigger language plpgsql security definer
    set search_path = public, pg_temp as $$ begin new.trusted_metadata=null; new.trigger_marker='cleared'; return new; end $$;
  create trigger trg_creator_platform_accounts_clear_trusted_metadata before update on public.creator_platform_accounts
    for each row execute function public.creator_publishing_platform_account_clear_trusted_metadata();
  create table public.unrelated_control(id integer primary key, marker text);
  insert into public.user_loras values(1,'training');
  insert into public.creator_platform_accounts values(1,'before','trusted','pending');
  insert into public.unrelated_control values(1,'unchanged');
  grant execute on function public.add_tokens(uuid,integer,text), public.deduct_tokens(uuid,integer), public.deduct_tokens(uuid,integer,text),
    public.record_lora_terminal_status(), public.creator_publishing_platform_account_clear_trusted_metadata() to anon, authenticated, service_role;
  grant select, update on public.user_loras, public.creator_platform_accounts to authenticated;
`;
const privilegeQuery = role => `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and (p.proname,oidvectortypes(p.proargtypes)) in (('add_tokens','uuid, integer, text'),('deduct_tokens','uuid, integer'),('deduct_tokens','uuid, integer, text'),('record_lora_terminal_status',''),('creator_publishing_platform_account_clear_trusted_metadata',''))
  and has_function_privilege('${role}',p.oid,'EXECUTE');`;
function publicAclCount() { return psql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='public' and a.grantee=0 and a.privilege_type='EXECUTE' and (p.proname,oidvectortypes(p.proargtypes)) in (('add_tokens','uuid, integer, text'),('deduct_tokens','uuid, integer'),('deduct_tokens','uuid, integer, text'),('record_lora_terminal_status',''),('creator_publishing_platform_account_clear_trusted_metadata',''));`).stdout.trim(); }
function expectPrivilege(role, count) { const got=psql(privilegeQuery(role)).stdout.trim(); if(got!==String(count)) throw new Error(`${role} privilege count ${got}, expected ${count}`); }
function expectDenied(role, call) {
  const result=psql(`\\set VERBOSITY verbose\nset role ${role}; ${call}`, false);
  if(!/42501|permission denied/i.test(result.stderr)) throw new Error(`expected 42501 permission denial: ${result.stderr}`);
}
function assertTriggerBehavior(suffix) {
  psql(`set role authenticated; update public.user_loras set status='ready${suffix}' where id=1; update public.creator_platform_accounts set label='after${suffix}' where id=1;`);
  const got=psql(`select marker from public.lora_terminal_events order by ctid desc limit 1; select coalesce(trusted_metadata,'<null>')||':'||trigger_marker from public.creator_platform_accounts where id=1;`).stdout.trim().split('\n');
  if(got.join(',')!==`terminal:ready${suffix},<null>:cleared`) throw new Error(`trigger behavior failed: ${got}`);
}

psql(fixture);
const tokenSignatureRepresentations = psql(`select p.proname, pg_get_function_identity_arguments(p.oid), oidvectortypes(p.proargtypes)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('add_tokens','deduct_tokens') order by 1, 3;`).stdout.trim().split('\n');
assert.deepEqual(tokenSignatureRepresentations, [
  'add_tokens|p_user_id uuid, p_amount integer, p_purchase_type text|uuid, integer, text',
  'deduct_tokens|p_user_id uuid, p_amount integer|uuid, integer',
  'deduct_tokens|p_user_id uuid, p_amount integer, p_description text|uuid, integer, text',
]);
for(const role of ['anon','authenticated','service_role']) expectPrivilege(role,5);
if(publicAclCount()!=='5') throw new Error('precondition PUBLIC ACL count mismatch');
const beforeFunctions=psql(functionRows).stdout; const beforeTriggers=psql(triggerRows).stdout;
psql(migration);
for(const role of ['anon','authenticated']) expectPrivilege(role,0); expectPrivilege('service_role',5);
if(publicAclCount()!=='0') throw new Error('PUBLIC EXECUTE remained');
for(const role of ['anon','authenticated']) {
  expectDenied(role, `select public.add_tokens('00000000-0000-0000-0000-000000000001',1,'fixture');`);
  expectDenied(role, `select public.deduct_tokens('00000000-0000-0000-0000-000000000001',1);`);
  expectDenied(role, `select public.deduct_tokens('00000000-0000-0000-0000-000000000001',1,'fixture');`);
}
psql(`set role service_role; select public.add_tokens('00000000-0000-0000-0000-000000000001',1,'fixture'); select public.deduct_tokens('00000000-0000-0000-0000-000000000001',1); select public.deduct_tokens('00000000-0000-0000-0000-000000000001',1,'fixture');`);
assertTriggerBehavior('1');
if(psql(functionRows).stdout!==beforeFunctions || psql(triggerRows).stdout!==beforeTriggers) throw new Error('forward migration changed function/trigger fingerprints');
if(psql(`select marker from public.unrelated_control`).stdout.trim()!=='unchanged') throw new Error('control changed');

psql(fixture); const rollbackFunctions=psql(functionRows).stdout; const rollbackTriggers=psql(triggerRows).stdout;
psql(migration); psql(rollback);
for(const role of ['anon','authenticated','service_role']) expectPrivilege(role,5);
if(publicAclCount()!=='5') throw new Error('rollback did not restore PUBLIC');
assertTriggerBehavior('2');
if(psql(functionRows).stdout!==rollbackFunctions || psql(triggerRows).stdout!==rollbackTriggers) throw new Error('rollback changed function/trigger fingerprints');
if(psql(`select marker from public.unrelated_control`).stdout.trim()!=='unchanged') throw new Error('rollback changed control');
console.log('LOCK-03C2B disposable PostgreSQL integration passed: five ACL boundaries, token-call denials, trigger paths, immutability, and rollback verified');
