import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const databaseUrl = process.env.LOCK06_DATABASE_URL;
if (!databaseUrl) throw new Error('LOCK06_DATABASE_URL is required; no database was contacted');
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port !== '5432' || url.pathname !== '/lock06_test' || url.search || url.hash) {
  throw new Error('LOCK06 safety boundary rejected non-local or unexpected database URL');
}

const forwardPath = process.env.LOCK06_FORWARD_PATH ?? 'supabase/manual/lock06_supabase_production_boundary_forward.sql';
const forward = readFileSync(forwardPath, 'utf8');
const rollback = readFileSync('supabase/manual/lock06_supabase_production_boundary_rollback.sql', 'utf8');

function psql(sql, expectSuccess = true) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql, encoding: 'utf8' });
  if ((result.status === 0) !== expectSuccess) throw new Error(`psql expectation failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

const fixture = `
  drop schema public cascade;
  create schema public authorization postgres;
  do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    alter role service_role bypassrls;
  end $$;
  grant usage on schema public to anon, authenticated, service_role;

  create table public.purchases(id integer primary key, tier text not null);
  insert into public.purchases values (1,'early_monthly'),(2,'og_throne');
  alter table public.purchases enable row level security;
  create view public.sale_counters as
    select count(case when tier='early_monthly' then 1 end) as early_monthly_sold,
           count(case when tier='early_lifetime' then 1 end) as early_lifetime_sold,
           count(case when tier='og_throne' then 1 end) as og_throne_sold
    from public.purchases;
  grant select on public.sale_counters to anon, authenticated, service_role;

  create table public.muses(id integer primary key, name text not null);
  alter table public.muses enable row level security;
  create policy "public read muses" on public.muses for select using (true);
  grant all privileges on table public.muses to anon, authenticated, service_role;
  insert into public.muses values (1,'fixture');

  create table public.user_loras(id integer primary key, user_id uuid not null, status text not null);
  create table public.lora_status_events(lora_id integer, user_id uuid, old_status text, new_status text);
  create function public.record_lora_terminal_status() returns trigger language plpgsql security definer as $$
  begin
    if old.status is distinct from new.status and new.status in ('completed','failed') then
      insert into public.lora_status_events(lora_id,user_id,old_status,new_status)
      values(new.id,new.user_id,old.status,new.status);
    end if;
    return new;
  end $$;
  revoke execute on function public.record_lora_terminal_status() from public, anon, authenticated;
  grant execute on function public.record_lora_terminal_status() to service_role;
  create trigger lora_terminal_status_trigger after update of status on public.user_loras
    for each row execute function public.record_lora_terminal_status();
  insert into public.user_loras values(1,'00000000-0000-0000-0000-000000000001','training');

  alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant usage, select on sequences to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public revoke execute on functions from public;
`;

function scalar(sql) { return psql(sql).stdout.trim(); }
function bool(sql) { return scalar(sql) === 't'; }
function expectDenied(role, sql) {
  const result = psql(`set role ${role}; ${sql}`, false);
  if (!/42501|permission denied/i.test(result.stderr)) throw new Error(`expected permission denial for ${role}: ${result.stderr}`);
}
function functionSourceHash() {
  return scalar("select md5(prosrc) from pg_proc where oid='public.record_lora_terminal_status()'::regprocedure");
}
function triggerHash() {
  return scalar("select md5(pg_get_triggerdef(oid)) from pg_trigger where tgrelid='public.user_loras'::regclass and tgname='lora_terminal_status_trigger' and not tgisinternal");
}
function futureFixture(prefix) {
  psql(`create table public.${prefix}_table(id integer primary key); create sequence public.${prefix}_seq; create function public.${prefix}_fn() returns integer language sql as 'select 1';`);
}
function publicFunctionExecute(prefix) {
  return bool(`select has_function_privilege('public','public.${prefix}_fn()','EXECUTE')`);
}
function assertFutureDataApiGrants(prefix, expected) {
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal(bool(`select has_table_privilege('${role}','public.${prefix}_table','SELECT')`), expected, `${role} future table SELECT`);
    assert.equal(bool(`select has_function_privilege('${role}','public.${prefix}_fn()','EXECUTE')`), expected, `${role} future function EXECUTE`);
    assert.equal(bool(`select has_sequence_privilege('${role}','public.${prefix}_seq','USAGE')`), expected, `${role} future sequence USAGE`);
    assert.equal(bool(`select has_sequence_privilege('${role}','public.${prefix}_seq','SELECT')`), expected, `${role} future sequence SELECT`);
  }
  assert.equal(
    publicFunctionExecute(prefix),
    expected,
    expected ? 'PUBLIC default EXECUTE restored' : 'PUBLIC default EXECUTE remains revoked',
  );
}

psql(fixture);
const beforeSource = functionSourceHash();
const beforeTrigger = triggerHash();
assert.equal(scalar("select coalesce(array_to_string(reloptions,','),'<null>') from pg_class where oid='public.sale_counters'::regclass"), '<null>');
assert.equal(scalar("select count(*) from pg_policy where polrelid='public.muses'::regclass and polname='public read muses'"), '1');
assert.equal(scalar("select coalesce(array_to_string(proconfig,','),'<null>') from pg_proc where oid='public.record_lora_terminal_status()'::regprocedure"), '<null>');

psql(forward);
assert.equal(scalar("select coalesce(array_to_string(reloptions,','),'<null>') from pg_class where oid='public.sale_counters'::regclass"), 'security_invoker=true');
for (const role of ['anon','authenticated']) {
  assert.equal(bool(`select has_table_privilege('${role}','public.sale_counters','SELECT')`), false);
  assert.equal(bool(`select has_table_privilege('${role}','public.muses','SELECT')`), false);
  expectDenied(role, 'select * from public.sale_counters;');
  expectDenied(role, 'select * from public.muses;');
}
assert.equal(bool("select has_table_privilege('service_role','public.sale_counters','SELECT')"), true);
assert.equal(bool("select has_table_privilege('service_role','public.muses','SELECT')"), true);
assert.equal(scalar("select count(*) from pg_policy where polrelid='public.muses'::regclass"), '0');
assert.equal(scalar("select array_to_string(proconfig,',') from pg_proc where oid='public.record_lora_terminal_status()'::regprocedure"), 'search_path=pg_catalog, pg_temp');
assert.equal(functionSourceHash(), beforeSource, 'function source changed');
assert.equal(triggerHash(), beforeTrigger, 'trigger definition changed');
psql("update public.user_loras set status='completed' where id=1;");
assert.equal(scalar("select old_status||'>'||new_status from public.lora_status_events where lora_id=1 order by ctid desc limit 1"), 'training>completed');
futureFixture('after_lock06');
assertFutureDataApiGrants('after_lock06', false);

psql(rollback);
assert.equal(scalar("select coalesce(array_to_string(reloptions,','),'<null>') from pg_class where oid='public.sale_counters'::regclass"), '<null>');
for (const role of ['anon','authenticated']) {
  assert.equal(bool(`select has_table_privilege('${role}','public.sale_counters','SELECT')`), true);
  assert.equal(bool(`select has_table_privilege('${role}','public.muses','SELECT')`), true);
}
assert.equal(scalar("select count(*) from pg_policy where polrelid='public.muses'::regclass and polname='public read muses' and pg_get_expr(polqual,polrelid)='true'"), '1');
assert.equal(scalar("select coalesce(array_to_string(proconfig,','),'<null>') from pg_proc where oid='public.record_lora_terminal_status()'::regprocedure"), '<null>');
assert.equal(functionSourceHash(), beforeSource, 'rollback changed function source');
assert.equal(triggerHash(), beforeTrigger, 'rollback changed trigger definition');
futureFixture('after_rollback');
assertFutureDataApiGrants('after_rollback', true);

console.log('LOCK-06 disposable PostgreSQL integration passed: view containment, dormant muses containment, trigger search_path hardening, future Data API defaults, and rollback verified');
