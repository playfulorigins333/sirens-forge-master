import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"

function localUrl(name, database) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) || url.port !== "5432" || url.pathname !== `/${database}` || url.search || url.hash) throw new Error(`${name} must target loopback PostgreSQL port 5432 database ${database}`)
  return raw
}
const database = "publishing_disconnect_ci"
const adminUrl = localUrl("DATABASE_URL", "postgres")
const testUrl = localUrl("PUBLISHING_DISCONNECT_DATABASE_URL", database)
function psql(url, args, input) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", input })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `psql exited ${result.status}`)
  return result.stdout
}
function asyncPsql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [testUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql])
    let stdout = "", stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("exit", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)))
  })
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const bootstrap = `
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists extensions; create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),created_at timestamptz default now());
create table public.generations(id uuid primary key default gen_random_uuid(),user_id uuid,status text,prompt text,image_url text,mode text,body_type text,job_type text,r2_bucket text,r2_key text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz default now());`
const migrations = [
  "20251222_autopost_v1.sql", "20260625193000_autopost_x_text_mvp_foundation.sql",
  "20260710000100_creator_publishing_queue_foundation.sql", "20260710000200_creator_publishing_compliance_manual_review_outcome.sql", "20260710000300_creator_publishing_manual_review_workflow.sql", "20260710000400_creator_publishing_creator_approval_queue.sql", "20260710000500_creator_publishing_media_upload_intents.sql", "20260710000600_creator_publishing_generated_media_association.sql", "20260710000700_creator_publishing_platform_account_setup.sql", "20260710000800_creator_publishing_package_composer.sql", "20260710000900_creator_publishing_trusted_verification.sql", "20260710001000_creator_publishing_ai_twin_consent.sql", "20260710001100_creator_publishing_trusted_compliance_submission.sql",
  "20260711001200_creator_publishing_autopost_orchestration.sql", "20260711001300_creator_publishing_scheduler_due_state.sql", "20260712001400_creator_publishing_onlyfans_operator_queue.sql", "20260716001500_creator_publishing_onlyfans_manual_completion.sql", "20260718001700_creator_publishing_onlyfans_history_timeline.sql", "20260721001800_creator_publishing_verified_destination_guards.sql", "20260721001900_creator_publishing_scheduler_retry_exhaustion.sql", "20260721002000_creator_publishing_scheduler_retry_exhaustion_recovery.sql",
  "20260813035247_fanvue_oauth_cpq_account_bridge.sql", "20260814022245_cpq_fanvue_accounts_packages_nonrunnable.sql", "20260814090000_cpq_fanvue_launch_execution_foundation.sql",
  "20260817040000_cpq_fanvue_generated_media_attachment.sql", "20260817170000_cpq_fanvue_public_activation.sql", "20260817170050_cpq_fanvue_direct_compliance_facts.sql", "20260817170100_cpq_fanvue_direct_compliance_approval.sql", "20260817170200_cpq_fanvue_direct_preparation_hardening.sql", "20260818164748_cpq_fanvue_ai_persona_policy_correction.sql",
]
psql(adminUrl, ["-c", `drop database if exists ${database} with (force)`])
psql(adminUrl, ["-c", `create database ${database}`])
try {
  psql(testUrl, [], bootstrap)
  for (const migration of migrations) psql(testUrl, ["-f", join("supabase/migrations", migration)])
  psql(testUrl, ["-f", "supabase/migrations/20260823090000_publishing_provider_disconnect_truth.sql"])
  const output = psql(testUrl, ["-f", "backend/autopost/tests/publishingProviderDisconnectPostgresIntegration.sql"])
  if (!output.includes("PUBLISHING_PROVIDER_DISCONNECT_POSTGRES_ASSERTIONS_PASSED")) throw new Error("behavior marker missing")
  const holder = asyncPsql("begin; select id from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000006' for update; select pg_sleep(1); commit;")
  await delay(150)
  const disconnect = asyncPsql("select public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000006','x');")
  await delay(150)
  const dispatch = asyncPsql("select public.autopost_begin_x_dispatch('a1000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000006','race-lock');")
  const [, disconnectResult, dispatchResult] = await Promise.all([holder, disconnect, dispatch])
  if (JSON.parse(disconnectResult).unpublished_jobs_cancelled !== 1 || dispatchResult !== "f") throw new Error(`race invariant failed: disconnect=${disconnectResult} dispatch=${dispatchResult}`)
  const durable = psql(testUrl, ["-Atq", "-c", "with stale_result as (update public.autopost_jobs set state='SUCCEEDED' where id='a4000000-0000-4000-8000-000000000006' and state='RUNNING' and lock_id='race-lock' returning id) select (select state from public.autopost_jobs where id='a4000000-0000-4000-8000-000000000006')||':'||(select count(*) from stale_result);"])
  if (durable.trim() !== "SKIPPED:0") throw new Error(`stale result guard failed: ${durable}`)
  console.log("publishing provider disconnect PostgreSQL integration: PASS")
} finally {
  psql(adminUrl, ["-c", `drop database if exists ${database} with (force)`])
}
