import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.LOCK03C2A_DATABASE_URL;
if (!databaseUrl) throw new Error("LOCK03C2A_DATABASE_URL is required; no database was contacted");
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || url.port !== '5432' || url.pathname !== '/lock03c2a_test' || url.search || url.hash) {
  throw new Error("LOCK03C2A safety boundary rejected non-local or unexpected database URL");
}

const migration = readFileSync("supabase/migrations/20260811004900_lock03c2a_view_boundary.sql", "utf8");
const rollback = readFileSync("supabase/manual/lock03c2a_view_boundary_rollback.sql", "utf8");
function psql(sql, expectSuccess = true) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: sql, encoding: "utf8" });
  if ((result.status === 0) !== expectSuccess) {
    throw new Error(`psql expectation failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return result;
}
function expectDenied(role, relation) {
  const result = psql(`set role ${role}; select * from ${relation};`, false);
  if (!/permission denied/i.test(result.stderr)) throw new Error(`expected 42501-style permission denial for ${role} on ${relation}: ${result.stderr}`);
}
function fixture() {
  return `
    drop schema if exists auth cascade; drop schema public cascade; create schema public; create schema auth;
    do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select from pg_roles where rolname='lock03c2a_reader') then create role lock03c2a_reader nologin; end if;
      alter role service_role bypassrls;
    end $$;
    grant usage on schema public to anon, authenticated, service_role, lock03c2a_reader;
    grant usage on schema auth to service_role;

    create table auth.users (id uuid primary key, email text not null);
    create table public.user_loras (id uuid primary key, user_id uuid not null references auth.users(id), status text not null);
    insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'owner@example.test');
    insert into public.user_loras values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ready');
    create view public.lora_notification_payload as
      select l.id, l.status, u.email from public.user_loras l join auth.users u on u.id = l.user_id;
    grant select on public.lora_notification_payload to anon, authenticated, service_role;

    create table public.dataset_doctor_jobs (id integer primary key, owner_name text not null, status text not null);
    create table public.dataset_doctor_images (id integer primary key, job_id integer not null references public.dataset_doctor_jobs(id), verdict text not null);
    alter table public.dataset_doctor_jobs enable row level security;
    alter table public.dataset_doctor_images enable row level security;
    create policy reader_jobs on public.dataset_doctor_jobs for select to lock03c2a_reader using (owner_name = current_user);
    create policy reader_images on public.dataset_doctor_images for select to lock03c2a_reader using (
      exists (select 1 from public.dataset_doctor_jobs j where j.id = job_id and j.owner_name = current_user)
    );
    insert into public.dataset_doctor_jobs values (1, 'lock03c2a_reader', 'ready'), (2, 'someone_else', 'ready');
    insert into public.dataset_doctor_images values (11, 1, 'keep'), (22, 2, 'reject');
    create view public.dataset_doctor_review_v as
      select j.id as job_id, i.id as image_id, i.verdict from public.dataset_doctor_jobs j join public.dataset_doctor_images i on i.job_id = j.id;
    grant select on public.dataset_doctor_review_v to anon, authenticated, service_role;
    grant select on public.dataset_doctor_jobs, public.dataset_doctor_images to service_role, lock03c2a_reader;

    create table public.unrelated_control (id integer primary key, marker text not null);
    insert into public.unrelated_control values (1, 'unchanged');
  `;
}

psql(fixture());
const pre = psql(`set role service_role; select email from public.lora_notification_payload;`).stdout.trim();
if (pre !== "owner@example.test") throw new Error(`pre-migration notification read failed: ${pre}`);
expectDenied("service_role", "auth.users");
psql(migration);
expectDenied("anon", "public.lora_notification_payload");
expectDenied("authenticated", "public.lora_notification_payload");
expectDenied("anon", "public.dataset_doctor_review_v");
expectDenied("authenticated", "public.dataset_doctor_review_v");
const serviceRows = psql(`set role service_role; select email from public.lora_notification_payload; select count(*) from public.dataset_doctor_review_v;`).stdout.trim().split("\n");
if (serviceRows.join(",") !== "owner@example.test,2") throw new Error(`service-role view access changed: ${serviceRows}`);
expectDenied("service_role", "auth.users");
psql(`grant select on public.dataset_doctor_review_v to lock03c2a_reader;`);
const rlsCount = psql(`set role lock03c2a_reader; select count(*) from public.dataset_doctor_review_v;`).stdout.trim();
if (rlsCount !== "1") throw new Error(`security_invoker behavioral RLS proof failed: expected 1, got ${rlsCount}`);
const control = psql(`select marker from public.unrelated_control;`).stdout.trim();
if (control !== "unchanged") throw new Error("forward migration changed unrelated fixture object");

psql(fixture() + migration + rollback);
for (const role of ["anon", "authenticated", "service_role"]) {
  psql(`set role ${role}; select * from public.lora_notification_payload; select * from public.dataset_doctor_review_v;`);
}
const state = psql(`select coalesce(array_to_string(reloptions, ','), '<default>') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('lora_notification_payload','dataset_doctor_review_v') order by c.relname; select marker from public.unrelated_control;`).stdout.trim().split("\n");
if (state.join(",") !== "<default>,<default>,unchanged") throw new Error(`rollback state mismatch: ${state}`);
expectDenied("service_role", "auth.users");

console.log("LOCK-03C2A disposable PostgreSQL integration passed: browser denials, service paths, RLS behavior, and rollback verified");
