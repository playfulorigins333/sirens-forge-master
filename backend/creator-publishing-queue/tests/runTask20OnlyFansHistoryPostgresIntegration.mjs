import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TASK20_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TASK20_DATABASE_URL or DATABASE_URL is required');
const adminUrl = process.env.DATABASE_URL || databaseUrl;
function assertLocalDatabaseUrl(raw, expectedDatabase, label) {
  const parsed = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.port !== '5432' || parsed.pathname !== `/${expectedDatabase}` || parsed.search || parsed.hash) {
    throw new Error(`${label} must target local PostgreSQL database ${expectedDatabase} on port 5432`);
  }
}
assertLocalDatabaseUrl(databaseUrl, 'task20_ci', 'TASK20_DATABASE_URL');
assertLocalDatabaseUrl(adminUrl, 'postgres', 'DATABASE_URL');
const logPath = 'task20-postgres-diagnostics.log';
writeFileSync(logPath, `Task 20 PostgreSQL integration diagnostics\nstarted_at=${new Date().toISOString()}\n`);

function printTail() {
  try { console.error(readFileSync(logPath, 'utf8').split(/\n/).slice(-180).join('\n')); } catch {}
}
function runFile(label, file, url = databaseUrl) {
  appendFileSync(logPath, `\n## ${label}: ${file}\nurl=${url}\n`);
  const res = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
  appendFileSync(logPath, res.stdout || '');
  appendFileSync(logPath, res.stderr || '');
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`);
  if (res.status !== 0) {
    console.error(res.stdout || '');
    console.error(res.stderr || '');
    throw new Error(`${label} failed with status ${res.status}`);
  }
}
function runSql(label, sql, url = databaseUrl) {
  const file = join(mkdtempSync(join(tmpdir(), 'task20-sql-')), `${label.replace(/[^A-Za-z0-9_-]/g, '_')}.sql`);
  writeFileSync(file, sql);
  runFile(label, file, url);
}

const bootstrapSql = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create table if not exists auth.users(id uuid primary key, email text, created_at timestamptz default now());
create table if not exists public.profiles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), created_at timestamptz default now());
create table if not exists public.generations(id uuid primary key default gen_random_uuid(), user_id uuid, status text, r2_bucket text, r2_key text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz default now());
`;

const migrations = [
  '20260710000100_creator_publishing_queue_foundation.sql',
  '20260710000200_creator_publishing_compliance_manual_review_outcome.sql',
  '20260710000300_creator_publishing_manual_review_workflow.sql',
  '20260710000400_creator_publishing_creator_approval_queue.sql',
  '20260710000500_creator_publishing_media_upload_intents.sql',
  '20260710000600_creator_publishing_generated_media_association.sql',
  '20260710000700_creator_publishing_platform_account_setup.sql',
  '20260710000800_creator_publishing_package_composer.sql',
  '20260710000900_creator_publishing_trusted_verification.sql',
  '20260710001000_creator_publishing_ai_twin_consent.sql',
  '20260710001100_creator_publishing_trusted_compliance_submission.sql',
  '20260711001200_creator_publishing_autopost_orchestration.sql',
  '20260711001300_creator_publishing_scheduler_due_state.sql',
  '20260712001400_creator_publishing_onlyfans_operator_queue.sql',
  '20260716001500_creator_publishing_onlyfans_manual_completion.sql',
  '20260718001700_creator_publishing_onlyfans_history_timeline.sql'
].map((file) => `supabase/migrations/${file}`);

try {
  runSql('recreate-task20-database', 'drop database if exists task20_ci with (force); create database task20_ci;', adminUrl);
  runSql('bootstrap', bootstrapSql, databaseUrl);
  for (const migration of migrations) runFile(`migration-${migration.split('/').at(-1)}`, migration, databaseUrl);
  runFile('task20-test-support', 'backend/creator-publishing-queue/tests/task20OnlyFansHistoryTestSupport.sql', databaseUrl);
  runFile('task20-postgres-integration', 'backend/creator-publishing-queue/tests/task20OnlyFansHistoryPostgresIntegration.sql', databaseUrl);
  appendFileSync(logPath, `\nTASK20_POSTGRES_INTEGRATION_PASSED\ncompleted_at=${new Date().toISOString()}\n`);
  console.log('TASK20_POSTGRES_INTEGRATION_PASSED');
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`);
  printTail();
  process.exit(1);
}
