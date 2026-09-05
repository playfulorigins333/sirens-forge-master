import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.PROFILE_LIFECYCLE_GRANTS_DATABASE_URL;
if (!databaseUrl) throw new Error("PROFILE_LIFECYCLE_GRANTS_DATABASE_URL is required; no database was contacted");
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5432' || url.pathname !== '/profile_lifecycle_grants_test' || url.search || url.hash) {
  throw new Error("Safety boundary rejected remote, non-local, or incorrectly named database URL");
}
const migration = readFileSync("supabase/migrations/20260905031400_profile_lifecycle_column_select_grants.sql", "utf8");
function psql(statement, expectedSuccess = true) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: statement, encoding: "utf8" });
  if ((result.status === 0) !== expectedSuccess) throw new Error(`psql expectation failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result.stdout.trim();
}

psql(`
drop schema if exists auth cascade; drop schema public cascade; create schema public authorization postgres; create schema auth authorization postgres;
do $$begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  alter role service_role bypassrls;
end$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key, user_id uuid unique not null references auth.users(id), email text, badge text, seat_number integer,
  stripe_customer_id text, account_lifecycle_state text not null default 'active',
  account_lifecycle_updated_at timestamptz not null default clock_timestamp(), password_hash text
);
alter table public.profiles enable row level security;
create policy profiles_authenticated_own_select on public.profiles as permissive for select to authenticated using (user_id = auth.uid());
grant select on table public.profiles to service_role;
grant select(id,user_id,email,badge,seat_number,stripe_customer_id) on public.profiles to authenticated;
insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.profiles(id,user_id,email,badge,seat_number,stripe_customer_id,password_hash) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','a@example.invalid','A',1,'cus_a','hash-a'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','b@example.invalid','B',2,'cus_b','hash-b');
`);
assert.equal(psql("select has_column_privilege('authenticated','public.profiles','account_lifecycle_state','SELECT');"), "f");
psql(migration);

assert.equal(psql(`select has_table_privilege('authenticated','public.profiles','SELECT')||'|'||has_column_privilege('authenticated','public.profiles','account_lifecycle_state','SELECT')||'|'||has_column_privilege('authenticated','public.profiles','account_lifecycle_updated_at','SELECT')||'|'||has_column_privilege('authenticated','public.profiles','password_hash','SELECT');`), "false|true|true|false");
assert.equal(psql(`select has_table_privilege('anon','public.profiles','SELECT')||'|'||has_column_privilege('anon','public.profiles','account_lifecycle_state','SELECT')||'|'||has_column_privilege('anon','public.profiles','account_lifecycle_updated_at','SELECT')||'|'||has_column_privilege('anon','public.profiles','password_hash','SELECT');`), "false|false|false|false");
assert.equal(psql("select has_table_privilege('service_role','public.profiles','SELECT');"), "t");
assert.equal(psql("select relrowsecurity||'|'||relforcerowsecurity from pg_class where oid='public.profiles'::regclass;"), "true|false");
assert.equal(psql(`select count(*)||'|'||bool_and(polroles=array['authenticated'::regrole::oid])||'|'||bool_and(regexp_replace(lower(pg_get_expr(polqual,polrelid)),'[[:space:]()]','','g')='user_id=auth.uid') from pg_policy where polrelid='public.profiles'::regclass and polcmd='r' and polname='profiles_authenticated_own_select';`), "1|true|true");
assert.equal(psql("select count(*) from pg_policy where polrelid='public.profiles'::regclass and polcmd='r';"), "1");

const context = "set role authenticated; set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';";
assert.match(psql(`${context} select id,user_id,email,badge,seat_number,account_lifecycle_state from public.profiles where user_id=auth.uid();`), /a@example\.invalid\|A\|1\|active$/);
assert.match(psql(`${context} select id,user_id,email,badge,seat_number,stripe_customer_id,account_lifecycle_state,account_lifecycle_updated_at from public.profiles where user_id=auth.uid();`), /a@example\.invalid\|A\|1\|cus_a\|active\|/);
assert.equal(psql(`${context} select account_lifecycle_state from public.profiles where user_id=auth.uid();`), "active");
assert.equal(psql(`${context} select count(*) from public.profiles where user_id='10000000-0000-4000-8000-000000000002';`), "0");
psql(`${context} select password_hash from public.profiles where user_id=auth.uid();`, false);
psql(`${context} select * from public.profiles where user_id=auth.uid();`, false);

console.log("Profile lifecycle column grants PostgreSQL 17 integration passed: exact ACLs, own-profile RLS, application reads, cross-user denial, and credential containment verified");
