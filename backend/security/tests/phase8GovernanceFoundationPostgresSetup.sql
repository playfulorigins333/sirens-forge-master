\set ON_ERROR_STOP on

drop schema if exists public cascade;
drop schema if exists auth cascade;
drop schema if exists extensions cascade;
create schema public authorization postgres;
create schema auth authorization postgres;
create schema extensions authorization postgres;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end
$$;
alter role service_role bypassrls;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create table auth.users(
  id uuid primary key
);

create table public.account_deletion_protected_subjects(
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default statement_timestamp()
);

revoke all on table auth.users, public.account_deletion_protected_subjects from public, anon, authenticated;
grant select on table auth.users, public.account_deletion_protected_subjects to service_role;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004');

insert into public.account_deletion_protected_subjects(auth_user_id,reason)
values ('10000000-0000-4000-8000-000000000001','sole_production_admin_guard');
