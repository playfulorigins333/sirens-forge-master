import { spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const logPath = 'task17a-postgres-diagnostics.log'
writeFileSync(logPath, `Task 17A PostgreSQL diagnostics\nstarted_at=${new Date().toISOString()}\n`)
const databaseUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
function runSql(label, sql) {
  appendFileSync(logPath, `\n## ${label}\n`)
  const file = join(mkdtempSync(join(tmpdir(), 'task17a-sql-')), `${label.replace(/[^a-z0-9_-]/gi, '_')}.sql`)
  writeFileSync(file, sql)
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
}
function runFile(label, file) {
  appendFileSync(logPath, `\n## ${label}: ${file}\n`)
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
}
try {
  runSql('bootstrap', `
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
  const migrations = [
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
    'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql'
  ]
  for (const migration of migrations) runFile('migration', migration)
  runFile('task15 regression post-01400', 'backend/creator-publishing-queue/tests/task15PostgresIntegration.sql')
  runFile('task17a test support', 'backend/creator-publishing-queue/tests/task17aTestSupport.sql')
  for (const f of ['task17aPostgresIntegration.sql','task17aAuthorizationTimingIntegration.sql','task17aIdempotencyRecoveryIntegration.sql','task17aSafetyGatesIntegration.sql','task17aSchedulerCompatibilityIntegration.sql']) runFile(`task17a ${f}`, `backend/creator-publishing-queue/tests/${f}`)
  const c = spawnSync(process.execPath, ['backend/creator-publishing-queue/tests/runTask17aConcurrency.mjs'], { stdio: 'inherit', env: process.env })
  if (c.status !== 0) throw new Error(`task17a concurrency failed with status ${c.status}`)
  const cc = spawnSync(process.execPath, ['backend/creator-publishing-queue/tests/runTask17aCancellationConcurrency.mjs'], { stdio: 'inherit', env: process.env })
  if (cc.status !== 0) throw new Error(`task17a cancellation concurrency failed with status ${cc.status}`)
  console.log('TASK17A_BEHAVIORAL_COVERAGE_COMPLETE')
  appendFileSync(logPath, `\nTASK17A_BEHAVIORAL_COVERAGE_COMPLETE\ncompleted_at=${new Date().toISOString()}\n`)
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\n`)
  process.exit(1)
}
