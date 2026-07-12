import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for Task 15 PostgreSQL integration')

function psql(args, input) {
  const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, ...args], { input, stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit', encoding: 'utf8' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

psql([], `
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create table if not exists public.profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.generations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid,
  status text not null default 'completed',
  r2_bucket text,
  r2_key text,
  metadata jsonb not null default '{}'::jsonb,
  lora_used boolean,
  job_type text,
  body_type text,
  mode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`)

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
]
for (const migration of migrations) {
  console.log(`Applying ${migration}`)
  psql(['--file', join(root, 'supabase/migrations', migration)])
}
console.log('Running Task 15 PostgreSQL integration assertions')
psql(['--file', join(root, 'backend/creator-publishing-queue/tests/task15PostgresIntegration.sql')])
