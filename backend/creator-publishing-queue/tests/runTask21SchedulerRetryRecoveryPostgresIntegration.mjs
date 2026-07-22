import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const logPath = "task21-scheduler-retry-recovery-postgres-diagnostics.log"
writeFileSync(logPath, `Gate 21C-5 PostgreSQL integration diagnostics\nstarted_at=${new Date().toISOString()}\n`)

function parseLocal(name, expectedDb) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (![/^postgres:$/.test(url.protocol), /^postgresql:$/.test(url.protocol)].some(Boolean)) throw new Error(`${name} must use PostgreSQL`)
  if (!new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(url.hostname)) throw new Error(`${name} must use a loopback host`)
  if (url.port !== "5432" || url.search || url.hash || url.pathname !== `/${expectedDb}`) throw new Error(`${name} must target loopback port 5432 database ${expectedDb} without query or fragment`)
  return raw
}

const adminUrl = parseLocal("DATABASE_URL", "postgres")
const taskUrl = parseLocal("TASK21_SCHEDULER_RETRY_RECOVERY_DATABASE_URL", "task21_scheduler_retry_recovery_ci")
const probe = spawnSync("psql", ["--version"], { encoding: "utf8" })
if (probe.status !== 0) {
  appendFileSync(logPath, `psql_unavailable=${probe.error?.message || probe.stderr || probe.status}\n`)
  process.exit(127)
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
  const file = join(mkdtempSync(join(tmpdir(), "task21-retry-recovery-")), `${label.replace(/[^A-Za-z0-9_-]/g, "_")}.sql`)
  writeFileSync(file, sql)
  runFile(label, file, url)
}

function runJson(label, sql) {
  appendFileSync(logPath, `\n## ${label}\n`)
  const result = spawnSync("psql", [taskUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { encoding: "utf8" })
  appendFileSync(logPath, result.stdout || "")
  appendFileSync(logPath, result.stderr || "")
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}`)
  const line = (result.stdout || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1)
  if (!line) throw new Error(`${label} returned no JSON`)
  return JSON.parse(line)
}

function spawnJson(label, sql) {
  return new Promise((resolve, reject) => {
    appendFileSync(logPath, `\n## ${label}\n`)
    const child = spawn("psql", [taskUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk.toString() })
    child.stderr.on("data", chunk => { stderr += chunk.toString() })
    child.on("error", reject)
    child.on("close", code => {
      appendFileSync(logPath, stdout)
      appendFileSync(logPath, stderr)
      if (code !== 0) return reject(new Error(`${label} failed with status ${code}`))
      try {
        const line = stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1)
        if (!line) throw new Error(`${label} returned no JSON`)
        resolve(JSON.parse(line))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function holdEventLock(eventId, seconds = 2) {
  const file = join(mkdtempSync(join(tmpdir(), "task21-retry-recovery-lock-")), "hold.sql")
  writeFileSync(file, `\\set ON_ERROR_STOP on\nbegin;\nselect pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_scheduler_retry_recovery:${eventId}',0));\n\\echo TASK21_RECOVERY_LOCK_READY\nselect pg_sleep(${seconds});\ncommit;\n`)
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [taskUrl, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let ready = false
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`timed out waiting for advisory lock ${eventId}`))
    }, 10000)
    child.stdout.on("data", chunk => {
      stdout += chunk.toString()
      if (!ready && stdout.includes("TASK21_RECOVERY_LOCK_READY")) {
        ready = true
        clearTimeout(timer)
        resolve({ child, done: new Promise((doneResolve, doneReject) => {
          child.on("error", doneReject)
          child.on("close", code => {
            appendFileSync(logPath, `\n## advisory-lock-${eventId}\n${stdout}${stderr}`)
            if (code !== 0) doneReject(new Error(`advisory lock holder failed with status ${code}`))
            else doneResolve()
          })
        }) })
      }
    })
    child.stderr.on("data", chunk => { stderr += chunk.toString() })
    child.on("error", error => {
      clearTimeout(timer)
      if (!ready) reject(error)
    })
    child.on("close", code => {
      clearTimeout(timer)
      if (!ready) reject(new Error(`advisory lock holder exited before ready with status ${code}: ${stderr}`))
    })
  })
}

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
  "20260721001800_creator_publishing_verified_destination_guards.sql",
  "20260721001900_creator_publishing_scheduler_retry_exhaustion.sql",
]

const seedAndSnapshots = `
insert into auth.users(id,email) values('21500000-0000-4000-8000-000000000101','recovery-snapshot@example.test');
insert into public.generations(id,user_id,status,prompt,metadata) values('21500000-0000-4000-8000-000000000301','21500000-0000-4000-8000-000000000101','completed','snapshot','{}');
insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at) values('21500000-0000-4000-8000-000000000401','21500000-0000-4000-8000-000000000101','onlyfans','recovery_snapshot','creator_attested',transaction_timestamp());
insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,platform_meta) values('21500000-0000-4000-8000-000000000501','21500000-0000-4000-8000-000000000101','21500000-0000-4000-8000-000000000401','onlyfans','snapshot','snapshot','none','{}',false,'pending','unassigned','pending','{}');
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values('21500000-0000-4000-8000-000000000001','21500000-0000-4000-8000-000000000101','scheduled','recovery-snapshot-plan',repeat('1',64),'task14.20260711.001');
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,schedule_revision,intended_publish_at,schedule_timezone,operator_due_at,scheduled_at,scheduled_by) values('21500000-0000-4000-8000-000000000201','21500000-0000-4000-8000-000000000001','21500000-0000-4000-8000-000000000101','21500000-0000-4000-8000-000000000501','21500000-0000-4000-8000-000000000401','onlyfans','assisted','scheduled_internally',transaction_timestamp(),repeat('2',64),'task14.20260711.001',repeat('3',64),1,transaction_timestamp()-interval '10 minutes','UTC',transaction_timestamp()-interval '70 minutes',transaction_timestamp(),'21500000-0000-4000-8000-000000000101');
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,created_at,updated_at) values('21500000-0000-4000-8000-000000000601','21500000-0000-4000-8000-000000000501','21500000-0000-4000-8000-000000000101','onlyfans','21500000-0000-4000-8000-000000000401','ready_for_handoff',transaction_timestamp(),transaction_timestamp());
insert into public.creator_publishing_scheduler_idempotency(creator_id,publishing_plan_id,action_type,idempotency_key,request_fingerprint,result,created_at) values('21500000-0000-4000-8000-000000000101','21500000-0000-4000-8000-000000000001','schedule','recovery-snapshot-schedule',repeat('4',64),'{}',transaction_timestamp());
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,processing_attempts,processed_at,safe_error_code) values('21500000-0000-4000-8000-000000000701','21500000-0000-4000-8000-000000000101','21500000-0000-4000-8000-000000000001','21500000-0000-4000-8000-000000000201','publish_due','blocked',transaction_timestamp()-interval '10 minutes',1,3,transaction_timestamp()-interval '1 minute','SCHEDULER_RETRY_EXHAUSTED');
insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_scheduler_event','21500000-0000-4000-8000-000000000701',null,'scheduler','snapshot_existing_audit','{}','{}','snapshot-audit-key',transaction_timestamp()-interval '2 minutes');

create table public.task21_recovery_pre_data_snapshot(entity_type text,entity_id text,row_data jsonb,primary key(entity_type,entity_id));
insert into public.task21_recovery_pre_data_snapshot
select 'account',id::text,to_jsonb(x) from public.creator_platform_accounts x
union all select 'package',id::text,to_jsonb(x) from public.creator_publishing_content_packages x
union all select 'plan',id::text,to_jsonb(x) from public.creator_publishing_plans x
union all select 'job',id::text,to_jsonb(x) from public.creator_publishing_platform_jobs x
union all select 'queue',id::text,to_jsonb(x) from public.creator_publishing_queue_tasks x
union all select 'event',id::text,to_jsonb(x) from public.creator_publishing_scheduler_events x
union all select 'audit',id::text,to_jsonb(x) from public.creator_publishing_audit_events x
union all select 'idempotency',creator_id::text||':'||action_type||':'||idempotency_key,to_jsonb(x) from public.creator_publishing_scheduler_idempotency x
union all select 'capability',platform,to_jsonb(x) from public.creator_publishing_platform_capabilities x
union all select 'generation',id::text,to_jsonb(x) from public.generations x;

create table public.task21_recovery_pre_function_snapshot(signature text primary key,definition text not null,acl text not null);
insert into public.task21_recovery_pre_function_snapshot
select p.oid::regprocedure::text,pg_get_functiondef(p.oid),coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';

create table public.task21_recovery_pre_relation_snapshot(relation_name text primary key,relkind char not null,relrowsecurity boolean not null,relacl text not null);
insert into public.task21_recovery_pre_relation_snapshot
select c.oid::regclass::text,c.relkind,c.relrowsecurity,coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname='creator_platform_accounts' or c.relname like 'creator_publishing_%');

create table public.task21_recovery_pre_constraint_snapshot(constraint_oid oid primary key,definition text not null);
insert into public.task21_recovery_pre_constraint_snapshot
select c.oid,pg_get_constraintdef(c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and (c.conrelid=0 or c.conrelid::regclass::text='creator_platform_accounts' or c.conrelid::regclass::text like 'creator_publishing_%');

create table public.task21_recovery_pre_index_snapshot(index_oid oid primary key,definition text not null);
insert into public.task21_recovery_pre_index_snapshot
select i.indexrelid,pg_get_indexdef(i.indexrelid) from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and (t.relname='creator_platform_accounts' or t.relname like 'creator_publishing_%');

create table public.task21_recovery_pre_trigger_snapshot(trigger_oid oid primary key,definition text not null);
insert into public.task21_recovery_pre_trigger_snapshot
select t.oid,pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and (c.relname='creator_platform_accounts' or c.relname like 'creator_publishing_%');`

function assertSameKeyConcurrency(results) {
  const normalized = results.map(result => JSON.stringify(result)).sort()
  const expected = [
    JSON.stringify({ ok: true, code: "SCHEDULER_RETRY_RECOVERY_REQUEUED", idempotent: false }),
    JSON.stringify({ ok: true, code: "SCHEDULER_RETRY_RECOVERY_REQUEUED", idempotent: true }),
  ].sort()
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) throw new Error(`same-key concurrency returned ${JSON.stringify(results)}`)
}

function assertDifferentKeyConcurrency(results) {
  const codes = results.map(result => `${result.ok}:${result.code}:${String(result.idempotent)}`).sort()
  const expected = [
    "false:SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE:undefined",
    "true:SCHEDULER_RETRY_RECOVERY_REQUEUED:false",
  ].sort()
  if (JSON.stringify(codes) !== JSON.stringify(expected)) throw new Error(`different-key concurrency returned ${JSON.stringify(results)}`)
}

async function concurrentPair(eventId, calls) {
  const holder = await holdEventLock(eventId)
  const results = await Promise.all(calls.map(({ label, sql }) => spawnJson(label, sql)))
  await holder.done
  return results
}

try {
  runSql("recreate", "drop database if exists task21_scheduler_retry_recovery_ci with (force); create database task21_scheduler_retry_recovery_ci;", adminUrl)
  runSql("bootstrap", bootstrap)
  for (const migration of migrations) runFile(`migration-${migration}`, `supabase/migrations/${migration}`)
  runSql("pre-02000-fixtures-and-snapshots", seedAndSnapshots)
  runFile("migration-02000", "supabase/migrations/20260721002000_creator_publishing_scheduler_retry_exhaustion_recovery.sql")
  runFile("gate-21c-5-assertions", "backend/creator-publishing-queue/tests/task21SchedulerRetryRecoveryPostgresIntegration.sql")

  const sameEvent = "21300000-0000-4005-8000-000000000070"
  const sameSql = `select public.creator_publishing_requeue_retry_exhausted_scheduler_event('${sameEvent}'::uuid,'concurrency_same_0070','MANUAL_RETRY_APPROVED')::text;`
  const sameResults = await concurrentPair(sameEvent, [
    { label: "same-key-concurrency-a", sql: sameSql },
    { label: "same-key-concurrency-b", sql: sameSql },
  ])
  assertSameKeyConcurrency(sameResults)

  const differentEvent = "21300000-0000-4005-8000-000000000071"
  const differentResults = await concurrentPair(differentEvent, [
    { label: "different-key-concurrency-a", sql: `select public.creator_publishing_requeue_retry_exhausted_scheduler_event('${differentEvent}'::uuid,'concurrency_diff_a_0071','MANUAL_RETRY_APPROVED')::text;` },
    { label: "different-key-concurrency-b", sql: `select public.creator_publishing_requeue_retry_exhausted_scheduler_event('${differentEvent}'::uuid,'concurrency_diff_b_0071','MANUAL_RETRY_APPROVED')::text;` },
  ])
  assertDifferentKeyConcurrency(differentResults)

  runSql("concurrency-final-assertions", `
  select task21_retry_recovery_test.assert((select status='pending' and processing_attempts=0 and processed_at is null and safe_error_code is null from public.creator_publishing_scheduler_events where id='${sameEvent}'::uuid),'same-key concurrency exact event state');
  select task21_retry_recovery_test.assert((select count(*)=1 from public.creator_publishing_audit_events where entity_id='${sameEvent}'::uuid and action='creator_publishing_scheduler_event_retry_requeued'),'same-key concurrency one audit');
  select task21_retry_recovery_test.assert((select status='pending' and processing_attempts=0 and processed_at is null and safe_error_code is null from public.creator_publishing_scheduler_events where id='${differentEvent}'::uuid),'different-key concurrency exact event state');
  select task21_retry_recovery_test.assert((select count(*)=1 from public.creator_publishing_audit_events where entity_id='${differentEvent}'::uuid and action='creator_publishing_scheduler_event_retry_requeued'),'different-key concurrency one audit');
  select task21_retry_recovery_test.assert((select count(distinct idempotency_key)=1 from public.creator_publishing_audit_events where entity_id='${differentEvent}'::uuid and action='creator_publishing_scheduler_event_retry_requeued'),'different-key concurrency one winning key');
  `)

  const replay = runJson("post-concurrency-replay", `select public.creator_publishing_requeue_retry_exhausted_scheduler_event('${sameEvent}'::uuid,'concurrency_same_0070','MANUAL_RETRY_APPROVED')::text;`)
  if (replay.ok !== true || replay.code !== "SCHEDULER_RETRY_RECOVERY_REQUEUED" || replay.idempotent !== true) throw new Error(`post-concurrency replay failed: ${JSON.stringify(replay)}`)

  appendFileSync(logPath, `\nTASK21_SCHEDULER_RETRY_RECOVERY_POSTGRES_INTEGRATION_PASSED\ncompleted_at=${new Date().toISOString()}\n`)
  console.log("TASK21_SCHEDULER_RETRY_RECOVERY_POSTGRES_INTEGRATION_PASSED")
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`)
  try { console.error(readFileSync(logPath,"utf8").split(/\n/).slice(-220).join("\n")) } catch {}
  process.exit(1)
}
