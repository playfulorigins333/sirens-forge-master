import { spawnSync } from "node:child_process"
import { join } from "node:path"

function localUrl(name, expectedDatabase) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`${name} must use PostgreSQL`)
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error(`${name} must use a loopback host`)
  if (url.pathname !== `/${expectedDatabase}` || url.search || url.hash) throw new Error(`${name} must target ${expectedDatabase} without query or fragment`)
  return raw
}
const adminUrl = localUrl("DATABASE_URL", "postgres")
const database = "fanvue_gate4b_ci"
const taskUrl = localUrl("FANVUE_GATE4B_DATABASE_URL", database)
function psql(url, args, input) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", input })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `psql exited ${result.status}`)
}
psql(adminUrl, ["-c", `drop database if exists ${database} with (force)`])
psql(adminUrl, ["-c", `create database ${database}`])
try {
  const bootstrap = `
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  `
  psql(taskUrl, [], bootstrap)
  const migrations = [
    "20251222_autopost_v1.sql",
    "20260625193000_autopost_x_text_mvp_foundation.sql",
    "20260710000100_creator_publishing_queue_foundation.sql",
    "20260710000200_creator_publishing_compliance_manual_review_outcome.sql",
    "20260710000300_creator_publishing_manual_review_workflow.sql",
    "20260710000400_creator_publishing_creator_approval_queue.sql",
    "20260710000500_creator_publishing_media_upload_intents.sql",
    "20260710000600_creator_publishing_generated_media_association.sql",
    "20260710000700_creator_publishing_platform_account_setup.sql",
    "20260710000800_creator_publishing_package_composer.sql",
    "20260710000900_creator_publishing_trusted_verification.sql",
    "20260813035247_fanvue_oauth_cpq_account_bridge.sql",
  ]
  for (const migration of migrations) psql(taskUrl, ["-f", join("supabase/migrations", migration)])
  psql(taskUrl, ["-f", "backend/autopost/tests/fanvueOAuthCpqBridgePostgresIntegration.sql"])
  console.log("fanvue OAuth/CPQ bridge PostgreSQL integration: PASS")
} finally {
  psql(adminUrl, ["-c", `drop database if exists ${database} with (force)`])
}
