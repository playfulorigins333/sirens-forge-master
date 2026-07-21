import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const logPath = "task21-scheduler-retry-exhaustion-postgres-diagnostics.log"
writeFileSync(logPath, `Gate 21C-4 PostgreSQL integration diagnostics\nstarted_at=${new Date().toISOString()}\n`)
function parseLocal(name, expectedDb) { const raw = process.env[name]; if (!raw) throw new Error(`${name} is required`); const url = new URL(raw); if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`${name} must use PostgreSQL`); if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error(`${name} must use a loopback host`); if (url.port !== "5432") throw new Error(`${name} must use port 5432`); if (url.search || url.hash) throw new Error(`${name} must not include query strings or fragments`); if (url.pathname !== `/${expectedDb}`) throw new Error(`${name} must target ${expectedDb}`); return raw }
const adminUrl = parseLocal("DATABASE_URL", "postgres")
const taskUrl = parseLocal("TASK21_SCHEDULER_RETRY_EXHAUSTION_DATABASE_URL", "task21_scheduler_retry_exhaustion_ci")
function runFile(label, file, url = taskUrl) { appendFileSync(logPath, `\n## ${label}: ${file}\n`); const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" }); appendFileSync(logPath, result.stdout || ""); appendFileSync(logPath, result.stderr || ""); if (result.error) appendFileSync(logPath, `spawn_error=${result.error.message}\n`); if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}`) }
function runSql(label, sql, url = taskUrl) { const file = join(mkdtempSync(join(tmpdir(), "task21-retry-exhaustion-")), `${label.replace(/[^A-Za-z0-9_-]/g, "_")}.sql`); writeFileSync(file, sql); runFile(label, file, url) }
try {
  runSql("create-db", "drop database if exists task21_scheduler_retry_exhaustion_ci; create database task21_scheduler_retry_exhaustion_ci;", adminUrl)
  runSql("bootstrap", `do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create schema if not exists auth; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create table if not exists auth.users(id uuid primary key, email text); create table if not exists public.profiles(id uuid primary key, user_id uuid); create table if not exists public.generations(id uuid primary key, user_id uuid, status text, prompt text, metadata jsonb not null default '{}'::jsonb);`)
  for (const migration of ["20260710000100_creator_publishing_queue_foundation.sql","20260710000700_creator_publishing_platform_account_setup.sql","20260710000800_creator_publishing_package_composer.sql","20260710000900_creator_publishing_trusted_verification.sql","20260710001000_creator_publishing_ai_twin_consent.sql","20260710001100_creator_publishing_trusted_compliance_submission.sql","20260711001300_creator_publishing_scheduler_due_state.sql","20260721001900_creator_publishing_scheduler_retry_exhaustion.sql"]) runFile("migration", `supabase/migrations/${migration}`)
  runFile("integration", "backend/creator-publishing-queue/tests/task21SchedulerRetryExhaustionPostgresIntegration.sql")
  console.log("task21 scheduler retry exhaustion PostgreSQL integration passed")
} catch (error) { try { console.error(readFileSync(logPath, "utf8").split(/\n/).slice(-200).join("\n")) } catch {} throw error }
