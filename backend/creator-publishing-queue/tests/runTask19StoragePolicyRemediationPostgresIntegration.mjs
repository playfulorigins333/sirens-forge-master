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
const logPath = join(
  tempDirectory,
  "task19-storage-policy-postgres-diagnostics.log",
);

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

  if not exists (
    select 1 from pg_roles where rolname = 'service_role'
  ) then
    create role service_role;
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

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;

drop schema if exists storage cascade;
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key,
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid
);

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update on storage.objects to anon, authenticated;
grant all on storage.objects to service_role;

create policy
  "allow anon uploads to lora-datasets"
on storage.objects
for insert
to anon
with check ((bucket_id = 'lora-datasets'::text));

create policy
  "allow authenticated uploads to lora-datasets"
on storage.objects
for insert
to authenticated
with check ((bucket_id = 'lora-datasets'::text));

create policy
  "authenticated users can upload lora datasets lk1r3q_0"
on storage.objects
for insert
to authenticated
with check ((auth.role() = 'authenticated'::text));

create policy
  "sf_lora_datasets_insert_public"
on storage.objects
for insert
to public
with check (
  (
    (bucket_id = 'lora-datasets'::text)
    and (name like 'lora_datasets/%'::text)
    and ((owner is null) or (owner = auth.uid()))
  )
);

create policy
  "sf_lora_datasets_update_public"
on storage.objects
for update
to public
using (
  (
    (bucket_id = 'lora-datasets'::text)
    and (name like 'lora_datasets/%'::text)
    and ((owner is null) or (owner = auth.uid()))
  )
)
with check (
  (
    (bucket_id = 'lora-datasets'::text)
    and (name like 'lora_datasets/%'::text)
    and ((owner is null) or (owner = auth.uid()))
  )
);

create policy
  "service role can read lora datasets"
on storage.objects
for select
to service_role
using (
  (
    (bucket_id = 'lora-datasets'::text)
    and (name like 'lora_datasets/%'::text)
  )
);

create policy
  "service role can upload lora datasets"
on storage.objects
for insert
to service_role
with check (
  (
    (bucket_id = 'lora-datasets'::text)
    and (name like 'lora_datasets/%'::text)
  )
);

create policy
  "service role full access to jobs"
on storage.objects
for all
to service_role
using ((bucket_id = 'jobs'::text))
with check ((bucket_id = 'jobs'::text));

create policy
  "users can read own job outputs"
on storage.objects
for select
to authenticated
using (
  (
    (bucket_id = 'jobs'::text)
    and (name like (auth.uid() || '/%'::text))
  )
);

insert into storage.buckets(id, name, public)
values
  ('lora-datasets', 'lora-datasets', false),
  ('jobs', 'jobs', false);

insert into storage.objects(id, bucket_id, name, owner)
values
  (
    '00000000-0000-4000-8000-000000000019',
    'lora-datasets',
    'lora_datasets/legacy-owner-null.jpg',
    null
  ),
  (
    '00000000-0000-4000-8000-000000000020',
    'lora-datasets',
    'lora_datasets/owned.jpg',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '00000000-0000-4000-8000-000000000021',
    'jobs',
    '00000000-0000-4000-8000-000000000001/output.png',
    '00000000-0000-4000-8000-000000000001'
  );

create temporary table task19_buckets_before as
select *
from storage.buckets;

create temporary table task19_objects_before as
select *
from storage.objects;

create temporary table task19_objects_acl_before as
select c.relacl
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'storage'
  and c.relname = 'objects';

do $$
begin
  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ) <> 9 then
    raise exception
      'TASK19_ASSERT: expected nine-policy fixture is incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname =
        'authenticated users can upload lora datasets lk1r3q_0'
      and cmd = 'INSERT'
      and roles = array['authenticated']::name[]
      and qual is null
      and with_check = '(auth.role() = ''authenticated''::text)'
  ) then
    raise exception
      'TASK19_ASSERT: authenticated role policy fixture differs from production';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'allow anon uploads to lora-datasets'
      and cmd = 'INSERT'
      and roles = array['anon']::name[]
      and qual is null
      and with_check = '(bucket_id = ''lora-datasets''::text)'
  ) then
    raise exception
      'TASK19_ASSERT: anonymous bucket policy fixture differs from production';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'allow authenticated uploads to lora-datasets'
      and cmd = 'INSERT'
      and roles = array['authenticated']::name[]
      and qual is null
      and with_check = '(bucket_id = ''lora-datasets''::text)'
  ) then
    raise exception
      'TASK19_ASSERT: authenticated bucket policy fixture differs from production';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sf_lora_datasets_insert_public'
      and cmd = 'INSERT'
      and roles = array['public']::name[]
      and qual is null
      and with_check =
        '((bucket_id = ''lora-datasets''::text) AND (name ~~ ''lora_datasets/%''::text) AND ((owner IS NULL) OR (owner = auth.uid())))'
  ) then
    raise exception
      'TASK19_ASSERT: PUBLIC insert policy fixture differs from production';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sf_lora_datasets_update_public'
      and cmd = 'UPDATE'
      and roles = array['public']::name[]
      and qual =
        '((bucket_id = ''lora-datasets''::text) AND (name ~~ ''lora_datasets/%''::text) AND ((owner IS NULL) OR (owner = auth.uid())))'
      and with_check =
        '((bucket_id = ''lora-datasets''::text) AND (name ~~ ''lora_datasets/%''::text) AND ((owner IS NULL) OR (owner = auth.uid())))'
  ) then
    raise exception
      'TASK19_ASSERT: PUBLIC update policy fixture differs from production';
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
