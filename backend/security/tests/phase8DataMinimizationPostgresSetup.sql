create extension if not exists pgcrypto with schema public;
create schema if not exists extensions;
alter extension pgcrypto set schema extensions;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth.users(id uuid primary key);

create table public.account_deletion_protected_subjects(
  auth_user_id uuid primary key,
  reason text not null
);

create type public.compute_workload as enum ('trainer','image','video','stitch');
create type public.compute_job_state as enum ('queued','claimed','running','recovering','cancel_requested','succeeded','failed','cancelled');

create table public.compute_jobs(
  id uuid primary key,
  owner_id uuid not null,
  workload public.compute_workload not null,
  state public.compute_job_state not null,
  request_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.generations(
  id uuid primary key,
  user_id uuid not null,
  prompt text,
  negative_prompt text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
