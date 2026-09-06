import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const url = process.env.MATERIAL_POLICY_DATABASE_URL || process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres"
const run = sql => spawnSync("psql", [url, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" })
const ok = (sql, label) => { const r = run(sql); assert.equal(r.status, 0, `${label}: ${r.stderr}`); return r.stdout.trim() }
const fail = (sql, pattern, label) => { const r = run(sql); assert.notEqual(r.status, 0, `${label} unexpectedly succeeded`); assert.match(r.stderr, pattern) }

ok(`drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth;
create extension if not exists pgcrypto; create table auth.users(id uuid primary key);
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;`, "reset roles")

ok(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key,user_id uuid unique not null);
insert into auth.users values('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
insert into profiles values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
create table public.payment_v2_holds(id uuid primary key,purchaser_credential_hash bytea not null);
insert into payment_v2_holds values('30000000-0000-0000-0000-000000000001',decode(repeat('ab',32),'hex'));
create table public.payment_v2_purchases(id uuid primary key,hold_id uuid references payment_v2_holds(id),claimed_profile_id uuid references profiles(id),state text);
insert into payment_v2_purchases values(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','CLAIMED');`, "bootstrap")

ok(readFileSync("supabase/migrations/20260822090000_material_policy_acceptance_receipts.sql", "utf8"), "base migration applies")
ok(readFileSync("supabase/migrations/20260906031000_material_policy_acceptance_manifest_rollforward.sql", "utf8"), "manifest rollforward applies")

const currentArgs = `'material-policy-2026-09-05-r1','terms-2026-09-05-r1','privacy-2026-09-05-r1','acceptable-use-2026-08-22-r1','material-policy-acceptance-2026-09-05-r1','policy-source-2026-09-05-r1','595ae993a8dab470851a849578fae424efdeddf512be44346397b6777dca6be0'`
const staleArgs = `'material-policy-2026-08-22-r1','terms-2026-08-22-r1','privacy-2026-08-22-r1','acceptable-use-2026-08-22-r1','material-policy-acceptance-2026-08-22-r1','policy-source-2026-08-22-r1','fac8d21b3a1f62eba47c01a32b84a7b492e5a2b4f21f5be86669a6eb4f7b23a3'`

const firstCheckout = ok(`select record_payment_first_material_policy_acceptance('30000000-0000-0000-0000-000000000001',decode(repeat('ab',32),'hex'),${currentArgs})`, "current checkout receipt")
assert.equal(ok(`select record_payment_first_material_policy_acceptance('30000000-0000-0000-0000-000000000001',decode(repeat('ab',32),'hex'),${currentArgs})`, "checkout idempotent retry"), firstCheckout)

const firstAuthenticated = ok(`select record_authenticated_material_policy_acceptance('20000000-0000-0000-0000-000000000002',${currentArgs})`, "current authenticated receipt")
assert.equal(ok(`select record_authenticated_material_policy_acceptance('20000000-0000-0000-0000-000000000002',${currentArgs})`, "authenticated idempotent retry"), firstAuthenticated)

assert.equal(ok("select count(*) from material_policy_acceptance_receipts", "two current receipts"), "2")
fail(`select record_payment_first_material_policy_acceptance('30000000-0000-0000-0000-000000000001',decode(repeat('ab',32),'hex'),${staleArgs})`, /material_policy_manifest_mismatch/, "stale checkout bundle rejected")
fail(`select record_authenticated_material_policy_acceptance('20000000-0000-0000-0000-000000000001',${staleArgs})`, /material_policy_manifest_mismatch/, "stale authenticated bundle rejected")
fail(`select record_payment_first_material_policy_acceptance('30000000-0000-0000-0000-000000000001',decode(repeat('cd',32),'hex'),${currentArgs})`, /hold_mismatch/, "unrelated credential")

fail("update material_policy_acceptance_receipts set terms_version='forged'", /immutable/, "update blocked")
fail("delete from material_policy_acceptance_receipts", /immutable/, "delete blocked")
fail("set role authenticated; insert into public.material_policy_acceptance_receipts(source,payment_v2_hold_id,material_bundle_version,terms_version,privacy_version,acceptable_use_version,acceptance_statement_version,source_revision,bundle_source_sha256) values('payment_first_checkout','30000000-0000-0000-0000-000000000001','x','x','x','x','x','x',repeat('a',64))", /permission denied/, "client forgery blocked")
assert.equal(ok("select has_function_privilege('authenticated','public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text)','execute')", "authenticated RPC privilege"), "f")
assert.equal(ok("select has_function_privilege('service_role','public.record_authenticated_material_policy_acceptance(uuid,text,text,text,text,text,text,text)','execute')", "service role authenticated RPC privilege"), "t")
assert.equal(ok("select has_function_privilege('authenticated','public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text)','execute')", "authenticated checkout RPC privilege"), "f")
assert.equal(ok("select has_function_privilege('service_role','public.record_payment_first_material_policy_acceptance(uuid,bytea,text,text,text,text,text,text,text)','execute')", "service role checkout RPC privilege"), "t")
assert.equal(ok("select (select claimed_profile_id from payment_v2_purchases where hold_id=r.payment_v2_hold_id) from material_policy_acceptance_receipts r where r.source='payment_first_checkout'", "claim attribution"), "10000000-0000-0000-0000-000000000001")

console.log("material policy acceptance PostgreSQL integration: PASS")
