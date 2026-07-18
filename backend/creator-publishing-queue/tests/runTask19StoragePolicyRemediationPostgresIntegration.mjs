import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirectory = mkdtempSync(
  join(tmpdir(), "task19-storage-policy-sql-"),
);
const migrationPath =
  "supabase/migrations/20260717001600_remove_broad_lora_storage_upload_policy.sql";
const assertionsPath =
  "backend/creator-publishing-queue/tests/task19StoragePolicyRemediationPostgresIntegration.sql";
const logPath = join(tempDirectory, "task19-storage-policy-postgres-diagnostics.log");

writeFileSync(
  logPath,
  `Task 19 Storage policy remediation PostgreSQL diagnostics\nstarted_at=${new Date().toISOString()}\n`,
);

const databaseUrl = process.env.TASK19_STORAGE_TEST_DATABASE_URL;

if (!databaseUrl) {
  appendFileSync(
    logPath,
    "FAILED: TASK19_STORAGE_TEST_DATABASE_URL is required.\n",
  );
  console.error(
    "TASK19_STORAGE_TEST_DATABASE_URL is required. No database was contacted.",
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  appendFileSync(logPath, "FAILED: invalid test database URL.\n");
  console.error("TASK19_STORAGE_TEST_DATABASE_URL is not a valid URL.");
  process.exit(1);
}

const allowedProtocols = new Set(["postgres:", "postgresql:"]);
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

if (
  !allowedProtocols.has(parsedUrl.protocol) ||
  !localHosts.has(parsedUrl.hostname) ||
  parsedUrl.port !== "5432" ||
  parsedUrl.pathname !== "/task19_storage_policy_test" ||
  parsedUrl.search !== "" ||
  parsedUrl.hash !== ""
) {
  appendFileSync(
    logPath,
    "FAILED: test database safety boundary rejected the supplied target.\n",
  );
  console.error(
    "Safety boundary rejected the database target. Use PostgreSQL on local port 5432 with database task19_storage_policy_test and no URL overrides.",
  );
  process.exit(1);
}

const migration = readFileSync(migrationPath, "utf8");
const assertions = readFileSync(assertionsPath, "utf8");

const bootstrap = String.raw`
\set ON_ERROR_STOP on
\echo 'Task 19 isolated fixture bootstrap starting'

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;

  if not exists (
    select 1 from pg_roles where rolname = 'authenticated'
  ) then
    create role authenticated;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

drop schema if exists storage cascade;
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null
);

create table storage.objects (
  id uuid primary key,
  bucket_id text not null references storage.buckets(id),
  name text not null
);

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated;
grant insert on storage.objects to authenticated;

create policy
  "authenticated users can upload lora datasets lk1r3q_0"
on storage.objects
for insert
to authenticated
with check ((auth.role() = 'authenticated'::text));

create policy "task19 unrelated storage select policy"
on storage.objects
for select
using (false);

insert into storage.buckets(id, name)
values ('task19-sentinel-bucket', 'task19-sentinel-bucket');

insert into storage.objects(id, bucket_id, name)
values (
  '00000000-0000-4000-8000-000000000019',
  'task19-sentinel-bucket',
  'task19/sentinel.jpg'
);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname =
        'authenticated users can upload lora datasets lk1r3q_0'
      and cmd = 'INSERT'
      and roles @> array['authenticated']::name[]
  ) then
    raise exception
      'TASK19_ASSERT: expected broad policy fixture is missing before migration';
  end if;
end
$$;

\echo 'Applying remediation migration for the first time'
`;

const repeat = String.raw`
\echo 'Applying remediation migration for the second time'
`;

const finish = String.raw`
rollback;

\echo 'TASK19_STORAGE_POLICY_REMEDIATION_ISOLATED_RUN_PASSED'
`;

const combinedSql = [
  bootstrap,
  migration,
  assertions,
  repeat,
  migration,
  assertions,
  finish,
].join("\n");

const sqlFile = join(tempDirectory, "task19-storage-policy-test.sql");

writeFileSync(sqlFile, combinedSql);

const result = spawnSync(
  "psql",
  [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlFile],
  {
    encoding: "utf8",
    env: process.env,
  },
);

appendFileSync(logPath, result.stdout || "");
appendFileSync(logPath, result.stderr || "");

if (result.error) {
  appendFileSync(logPath, `spawn_error=${result.error.message}\n`);
}

if (result.status !== 0) {
  appendFileSync(
    logPath,
    `FAILED: psql exited with status ${String(result.status)}\n`,
  );
  console.error(result.stderr || result.stdout || "PostgreSQL test failed.");
  process.exit(1);
}

appendFileSync(
  logPath,
  `completed_at=${new Date().toISOString()}\n`,
);

console.log(result.stdout.trim());
