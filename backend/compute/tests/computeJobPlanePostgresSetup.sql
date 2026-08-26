drop schema if exists auth cascade;
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create type public.lora_status as enum ('idle','queued','training','completed','failed','draft');
create table public.user_loras(
 id uuid primary key, user_id uuid not null references auth.users(id), status public.lora_status,
 training_job_id text, progress integer, started_at timestamptz, completed_at timestamptz, error_message text,
 artifact_r2_bucket text, artifact_r2_key text, dataset_r2_bucket text, dataset_r2_prefix text, trigger_token text, image_count integer,
 updated_at timestamptz not null default now()
);
create table public.generations(
 id uuid primary key, user_id uuid not null references auth.users(id), prompt text, image_url text, lora_used text, job_type text, body_type text, mode text, status text, negative_prompt text, steps integer, cfg_scale numeric, seed bigint, width integer, height integer, runpod_job_id text, processing_time_ms integer, completed_at timestamptz, metadata jsonb, r2_bucket text, r2_key text, updated_at timestamptz
);

do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end$$;
create table public.compute_unrelated_grant_sentinel(id integer primary key);
grant select on public.compute_unrelated_grant_sentinel to anon;
grant select, insert on public.compute_unrelated_grant_sentinel to authenticated;
