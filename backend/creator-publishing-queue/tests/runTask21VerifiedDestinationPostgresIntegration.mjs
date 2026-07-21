import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const logPath = "task21-verified-destination-postgres-diagnostics.log"
writeFileSync(logPath, `Gate 21C-1 PostgreSQL integration diagnostics\nstarted_at=${new Date().toISOString()}\n`)

function parseLocal(name, expectedDb) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`${name} must use PostgreSQL`)
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error(`${name} must use a loopback host`)
  if (url.port !== "5432") throw new Error(`${name} must use port 5432`)
  if (url.search || url.hash) throw new Error(`${name} must not include query strings or fragments`)
  if (url.pathname !== `/${expectedDb}`) throw new Error(`${name} must target ${expectedDb}`)
  return raw
}

const adminUrl = parseLocal("DATABASE_URL", "postgres")
const taskUrl = parseLocal("TASK21_VERIFIED_DESTINATION_DATABASE_URL", "task21_verified_destination_ci")

function printTail() {
  try { console.error(readFileSync(logPath, "utf8").split(/\n/).slice(-160).join("\n")) } catch {}
}

function runFile(label, file, url = taskUrl) {
  appendFileSync(logPath, `\n## ${label}: ${file}\n`)
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" })
  appendFileSync(logPath, result.stdout || "")
  appendFileSync(logPath, result.stderr || "")
  if (result.error) appendFileSync(logPath, `spawn_error=${result.error.message}\n`)
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}`)
}

function runSql(label, sql, url = taskUrl) {
  const file = join(mkdtempSync(join(tmpdir(), "task21-verified-destination-")), `${label.replace(/[^A-Za-z0-9_-]/g, "_")}.sql`)
  writeFileSync(file, sql)
  runFile(label, file, url)
}

const bootstrap = `
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
create table if not exists public.generations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  status text,
  prompt text,
  image_url text,
  mode text,
  body_type text,
  job_type text,
  r2_bucket text,
  r2_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
`

const baselineMigrations = [
  "20260710000100_creator_publishing_queue_foundation.sql",
  "20260710000200_creator_publishing_compliance_manual_review_outcome.sql",
  "20260710000300_creator_publishing_manual_review_workflow.sql",
  "20260710000400_creator_publishing_creator_approval_queue.sql",
  "20260710000500_creator_publishing_media_upload_intents.sql",
  "20260710000600_creator_publishing_generated_media_association.sql",
  "20260710000700_creator_publishing_platform_account_setup.sql",
  "20260710000800_creator_publishing_package_composer.sql",
  "20260710000900_creator_publishing_trusted_verification.sql",
  "20260710001000_creator_publishing_ai_twin_consent.sql",
  "20260710001100_creator_publishing_trusted_compliance_submission.sql",
  "20260711001200_creator_publishing_autopost_orchestration.sql",
  "20260711001300_creator_publishing_scheduler_due_state.sql",
  "20260712001400_creator_publishing_onlyfans_operator_queue.sql",
  "20260716001500_creator_publishing_onlyfans_manual_completion.sql",
  "20260718001700_creator_publishing_onlyfans_history_timeline.sql",
]

const preMigrationFixtures = `
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','creator@example.test'),
 ('22222222-2222-4222-8222-222222222222','reviewer@example.test')
on conflict do nothing;
insert into public.profiles(id,user_id) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111')
on conflict do nothing;

insert into public.creator_platform_accounts(
 id,creator_id,platform,platform_username,profile_url,verification_status,verification_attested_at,
 verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason,verification_legacy_revoked,is_virtual_entity
) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','onlyfans','unattested_account',null,'unattested',null,null,null,null,null,false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','onlyfans','attested_account',null,'creator_attested',clock_timestamp(),null,null,null,null,false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','11111111-1111-4111-8111-111111111111','onlyfans','revoked_account',null,'revoked',clock_timestamp(),'22222222-2222-4222-8222-222222222222',clock_timestamp(),null,'revoked fixture',false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','11111111-1111-4111-8111-111111111111','onlyfans','verified_account',null,'verified',clock_timestamp(),'22222222-2222-4222-8222-222222222222',clock_timestamp(),'fixture://verified-4','verified fixture',false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','11111111-1111-4111-8111-111111111111','onlyfans','verified_account_two',null,'verified',clock_timestamp(),'22222222-2222-4222-8222-222222222222',clock_timestamp(),'fixture://verified-5','verified fixture',false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','11111111-1111-4111-8111-111111111111','onlyfans','verified_replay_account',null,'verified',clock_timestamp(),'22222222-2222-4222-8222-222222222222',clock_timestamp(),'fixture://verified-6','verified fixture',false,false);

insert into public.generations(id,user_id,status,prompt,r2_bucket,r2_key,metadata) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','11111111-1111-4111-8111-111111111111','completed','historical fixture','fixture-bucket','historical-key','{}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','11111111-1111-4111-8111-111111111111','completed','verified fixture','fixture-bucket','verified-key','{}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','11111111-1111-4111-8111-111111111111','completed','verified fixture two','fixture-bucket','verified-key-two','{}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','11111111-1111-4111-8111-111111111111','completed','replay fixture','fixture-bucket','replay-key','{}');

insert into public.creator_publishing_content_packages(
 id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,ai_detail,second_person_present,
 compliance_status,compliance_policy_version,creator_approval_status,platform_meta,created_at,updated_at
) values
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','onlyfans','Historical attested package','historical','ai_generated','{}',false,'pending','unassigned','pending','{}',clock_timestamp(),clock_timestamp()),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','onlyfans','Verified package','verified','ai_generated','{}',false,'pending','unassigned','pending','{}',clock_timestamp(),clock_timestamp()),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','onlyfans','Verified package two','verified two','ai_generated','{}',false,'pending','unassigned','pending','{}',clock_timestamp(),clock_timestamp()),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','onlyfans','Replay plan package','replay plan','ai_generated','{}',false,'pending','unassigned','pending','{}',clock_timestamp(),clock_timestamp());

insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata) values
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','generated/historical','image/png',repeat('1',64),'ai_pipeline',jsonb_build_object('generation_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2','cccccccc-cccc-4ccc-8ccc-ccccccccccc2','generated/verified','image/png',repeat('2',64),'ai_pipeline',jsonb_build_object('generation_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3','cccccccc-cccc-4ccc-8ccc-ccccccccccc3','generated/verified-two','image/png',repeat('3',64),'ai_pipeline',jsonb_build_object('generation_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3')),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4','cccccccc-cccc-4ccc-8ccc-ccccccccccc4','generated/replay','image/png',repeat('4',64),'ai_pipeline',jsonb_build_object('generation_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'));

create table public.task21_verified_destination_snapshot as
select 'account'::text as entity_type,id,to_jsonb(a) as row_data from public.creator_platform_accounts a
union all
select 'package',id,to_jsonb(p) from public.creator_publishing_content_packages p
union all
select 'media',id,to_jsonb(m) from public.creator_publishing_media_assets m;

create table public.task21_scheduler_function_snapshot(signature text primary key, definition text not null);
insert into public.task21_scheduler_function_snapshot values
 ('creator_publishing_schedule_plan',pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure)),
 ('creator_publishing_process_scheduler_event',pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure)),
 ('creator_publishing_claim_due_scheduler_events',pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure)),
 ('creator_publishing_cancel_plan_schedule',pg_get_functiondef('public.creator_publishing_cancel_plan_schedule(uuid,uuid,text,text)'::regprocedure));
`

try {
  runSql("recreate-database", "drop database if exists task21_verified_destination_ci with (force); create database task21_verified_destination_ci;", adminUrl)
  runSql("bootstrap", bootstrap)
  for (const migration of baselineMigrations) runFile(`migration-${migration}`, `supabase/migrations/${migration}`)
  runSql("pre-01800-fixtures-and-snapshots", preMigrationFixtures)
  runFile("migration-01800", "supabase/migrations/20260721001800_creator_publishing_verified_destination_guards.sql")
  runFile("gate-21c-1-assertions", "backend/creator-publishing-queue/tests/task21VerifiedDestinationPostgresIntegration.sql")
  appendFileSync(logPath, `\nTASK21_VERIFIED_DESTINATION_POSTGRES_INTEGRATION_PASSED\ncompleted_at=${new Date().toISOString()}\n`)
  console.log("TASK21_VERIFIED_DESTINATION_POSTGRES_INTEGRATION_PASSED")
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`)
  printTail()
  process.exit(1)
}
