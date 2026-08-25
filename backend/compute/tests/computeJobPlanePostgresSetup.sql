drop schema if exists auth cascade;
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create table public.user_loras(
 id uuid primary key, user_id uuid not null references auth.users(id), status text,
 training_job_id uuid, dataset_r2_bucket text, dataset_r2_prefix text,
 updated_at timestamptz not null default now()
);
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end$$;
create table public.compute_unrelated_grant_sentinel(id integer primary key);
grant select on public.compute_unrelated_grant_sentinel to anon;
grant select, insert on public.compute_unrelated_grant_sentinel to authenticated;
