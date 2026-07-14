// TASK17A_SCENARIO_START: clean_01300_to_01400_upgrade
// TASK17A_SCENARIO_START: legacy_ownership_claimed_full_preflight
// TASK17A_SCENARIO_START: legacy_ownership_claimed_missing_both_preflight
// TASK17A_SCENARIO_START: legacy_ownership_claimed_missing_claimed_at_preflight
// TASK17A_SCENARIO_START: legacy_ownership_claimed_missing_claimed_by_preflight
// TASK17A_SCENARIO_START: legacy_ownership_nonclaimed_claimed_by_preflight
// TASK17A_SCENARIO_START: legacy_ownership_nonclaimed_claimed_at_preflight
// TASK17A_SCENARIO_START: legacy_ownership_nonclaimed_both_preflight
import { spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const psqlBin = process.env.PSQL || 'psql'
const probe = spawnSync(psqlBin, ['--version'], { encoding: 'utf8' })
if (probe.status !== 0) { console.error('[task17a-upgrade] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
const logPath = 'task17a-postgres-diagnostics.log'
const rootUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const base = new URL(rootUrl)
const adminUrl = new URL(rootUrl); adminUrl.pathname = '/postgres'
const migrationsThrough01300 = [
  'supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql',
  'supabase/migrations/20260710000200_creator_publishing_compliance_manual_review_outcome.sql',
  'supabase/migrations/20260710000300_creator_publishing_manual_review_workflow.sql',
  'supabase/migrations/20260710000400_creator_publishing_creator_approval_queue.sql',
  'supabase/migrations/20260710000500_creator_publishing_media_upload_intents.sql',
  'supabase/migrations/20260710000600_creator_publishing_generated_media_association.sql',
  'supabase/migrations/20260710000700_creator_publishing_platform_account_setup.sql',
  'supabase/migrations/20260710000800_creator_publishing_package_composer.sql',
  'supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql',
  'supabase/migrations/20260710001000_creator_publishing_ai_twin_consent.sql',
  'supabase/migrations/20260710001100_creator_publishing_trusted_compliance_submission.sql',
  'supabase/migrations/20260711001200_creator_publishing_autopost_orchestration.sql',
  'supabase/migrations/20260711001300_creator_publishing_scheduler_due_state.sql',
]
const migration01400 = 'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql'

function dbUrl(name) { const u = new URL(rootUrl); u.pathname = `/${name}`; return u.toString() }
function runPsql(url, label, sqlOrFile, isFile = false, expectOk = true) {
  appendFileSync(logPath, `\n## upgrade ${label}\n`)
  const args = [url, '-v', 'ON_ERROR_STOP=1']
  if (isFile) args.push('-f', sqlOrFile)
  else {
    const file = join(mkdtempSync(join(tmpdir(), 'task17a-upgrade-')), `${label.replace(/[^a-z0-9_-]/gi, '_')}.sql`)
    writeFileSync(file, sqlOrFile)
    args.push('-f', file)
  }
  const res = spawnSync(psqlBin, args, { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (expectOk && res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
  return res
}
function admin(label, sql, expectOk = true) { return runPsql(adminUrl.toString(), label, sql, false, expectOk) }
function createDb(label) {
  const name = `task17a_upgrade_${process.pid}_${label.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
  admin(`drop-${name}`, `drop database if exists ${name} with (force);`)
  admin(`create-${name}`, `create database ${name};`)
  return name
}
function dropDb(name) { admin(`drop-${name}`, `drop database if exists ${name} with (force);`, true) }
function bootstrap(url) {
  runPsql(url, 'bootstrap', `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create table if not exists auth.users(id uuid primary key, email text, created_at timestamptz default now());
    create table if not exists public.profiles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), created_at timestamptz default now());
    create table if not exists public.generations(id uuid primary key default gen_random_uuid(), user_id uuid, status text, r2_bucket text, r2_key text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz default now());
  `)
}
function applyThrough01300(url) { for (const m of migrationsThrough01300) runPsql(url, `migration-${m}`, m, true) }
function assertNoTask17a(url) {
  runPsql(url, 'assert-no-task17a-ddl', `
    do $$ begin
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name in ('claim_token','claim_expires_at','operator_progress_state')) then raise exception 'TASK17A_ASSERT:partial column installed'; end if;
      if to_regclass('public.creator_publishing_operator_authorizations') is not null then raise exception 'TASK17A_ASSERT:partial authorization table installed'; end if;
      if to_regclass('public.creator_publishing_operator_action_idempotency') is not null then raise exception 'TASK17A_ASSERT:partial idempotency table installed'; end if;
      if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'creator_publishing_%operator%') then raise exception 'TASK17A_ASSERT:partial function installed'; end if;
      if exists(select 1 from pg_constraint where conname like 'creator_publishing_queue_claim%') then raise exception 'TASK17A_ASSERT:partial constraint installed'; end if;
      if exists(select 1 from pg_indexes where schemaname='public' and indexname like 'creator_publishing_queue_claim%') then raise exception 'TASK17A_ASSERT:partial index installed'; end if;
    end $$;
  `)
}
function assertTask17aSchema(url) {
  runPsql(url, 'assert-task17a-schema', `
    do $$ begin
      if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token') then raise exception 'TASK17A_ASSERT:missing claim_token'; end if;
      if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_expires_at') then raise exception 'TASK17A_ASSERT:missing claim_expires_at'; end if;
      if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='operator_progress_state') then raise exception 'TASK17A_ASSERT:missing progress'; end if;
      if to_regclass('public.creator_publishing_operator_authorizations') is null then raise exception 'TASK17A_ASSERT:missing authz table'; end if;
      if to_regclass('public.creator_publishing_operator_action_idempotency') is null then raise exception 'TASK17A_ASSERT:missing idempotency table'; end if;
      if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='creator_publishing_operator_authorizations' and c.relrowsecurity) then raise exception 'TASK17A_ASSERT:authz rls missing'; end if;
      if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='creator_publishing_operator_action_idempotency' and c.relrowsecurity) then raise exception 'TASK17A_ASSERT:idempotency rls missing'; end if;
      if not exists(select 1 from pg_constraint where conname='creator_publishing_queue_claim_all_or_none') then raise exception 'TASK17A_ASSERT:missing all-or-none constraint'; end if;
      if not exists(select 1 from pg_indexes where indexname='creator_publishing_queue_claim_idx') then raise exception 'TASK17A_ASSERT:missing claim index'; end if;
      perform 1 from pg_proc where proname in ('creator_publishing_claim_onlyfans_operator_task','creator_publishing_release_onlyfans_operator_task','creator_publishing_update_onlyfans_operator_progress','creator_publishing_recover_expired_onlyfans_operator_claim','creator_publishing_cancel_plan_schedule','creator_publishing_cancel_job_schedule');
      if not found then raise exception 'TASK17A_ASSERT:missing functions'; end if;
      if not has_function_privilege('service_role','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') then raise exception 'TASK17A_ASSERT:service_role grant missing'; end if;
      if has_function_privilege('anon','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') then raise exception 'TASK17A_ASSERT:anon grant present'; end if;
    end $$;
  `)
}
function insertLegacy(url, shape) {
  const status = shape.startsWith('claimed') ? 'claimed' : 'ready_for_handoff'
  const claimedBy = ['claimed_full','claimed_missing_at','nonclaimed_by','nonclaimed_both'].includes(shape)
  const claimedAt = ['claimed_full','claimed_missing_by','nonclaimed_at','nonclaimed_both'].includes(shape)
  runPsql(url, `insert-legacy-${shape}`, `
    insert into auth.users(id,email) values('19000000-0000-4000-8000-000000000001','legacy@example.test'),('19000000-0000-4000-8000-000000000002','legacy-op@example.test') on conflict do nothing;
    insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status) values('19100000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','onlyfans','legacy','pending');
    insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,created_at,updated_at) values('19200000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000001','onlyfans','legacy',clock_timestamp(),clock_timestamp());
    insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values('19500000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','draft','legacy','1111111111111111111111111111111111111111111111111111111111111111','task14.20260711.001');
    insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at) values('19600000-0000-4000-8000-000000000001','19500000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','19200000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000001','onlyfans','assisted','draft',clock_timestamp(),'2222222222222222222222222222222222222222222222222222222222222222','task14.20260711.001','3333333333333333333333333333333333333333333333333333333333333333',clock_timestamp(),clock_timestamp());
    insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,claimed_by,claimed_at,created_at,updated_at) values('19700000-0000-4000-8000-000000000001','19200000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','onlyfans','19100000-0000-4000-8000-000000000001','${status}',${claimedBy ? `'19000000-0000-4000-8000-000000000002'` : 'null'},${claimedAt ? 'clock_timestamp()' : 'null'},clock_timestamp(),clock_timestamp());
  `)
}
async function scenario(label, body) {
  console.log(`TASK17A_SCENARIO_START: ${label}`)
  appendFileSync(logPath, `\nTASK17A_SCENARIO_START: ${label}\n`)
  const name = createDb(label)
  try { const url = dbUrl(name); bootstrap(url); applyThrough01300(url); await body(url) } finally { dropDb(name) }
}
try {
  await scenario('clean_01300_to_01400_upgrade', async (url) => {
    assertNoTask17a(url)
    runPsql(url, 'migration-01400-clean', migration01400, true)
    assertTask17aSchema(url)
    runPsql(url, 'task15-after-clean-upgrade', 'backend/creator-publishing-queue/tests/task15PostgresIntegration.sql', true)
  })
  for (const [label, shape] of [
    ['legacy_ownership_claimed_full_preflight','claimed_full'],
    ['legacy_ownership_claimed_missing_both_preflight','claimed_missing_both'],
    ['legacy_ownership_claimed_missing_claimed_at_preflight','claimed_missing_at'],
    ['legacy_ownership_claimed_missing_claimed_by_preflight','claimed_missing_by'],
    ['legacy_ownership_nonclaimed_claimed_by_preflight','nonclaimed_by'],
    ['legacy_ownership_nonclaimed_claimed_at_preflight','nonclaimed_at'],
    ['legacy_ownership_nonclaimed_both_preflight','nonclaimed_both'],
  ]) {
    await scenario(label, async (url) => {
      insertLegacy(url, shape)
      const res = runPsql(url, `migration-01400-${shape}-expected-failure`, migration01400, true, false)
      if (res.status === 0 || !`${res.stdout}\n${res.stderr}`.includes('TASK17A_LEGACY_CLAIMED_ROWS_REQUIRE_REMEDIATION')) throw new Error(`${label} did not fail with deterministic remediation error`)
      assertNoTask17a(url)
    })
  }
} catch (error) {
  appendFileSync(logPath, `\nUPGRADE FAILED: ${error?.stack || error}\n`)
  process.exit(1)
}
