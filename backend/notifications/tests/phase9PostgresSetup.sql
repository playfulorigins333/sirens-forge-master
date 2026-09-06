\set ON_ERROR_STOP on
drop schema if exists public cascade; drop schema if exists auth cascade; create schema public authorization postgres; create schema auth authorization postgres; create extension if not exists pgcrypto;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key,user_id uuid unique references auth.users(id));
create table public.creator_data_exports(id uuid primary key,auth_user_id uuid references auth.users(id),status text,ready_notification_due_at timestamptz,expires_at timestamptz);
-- Intentionally mirrors the real Production drift discovered after PR #358:
-- account_deletion_requests exists without the Phase 7 notification marker columns.
-- The 20260906035900 repair migration must add them before Phase 9 runs.
create table public.account_deletion_requests(id uuid primary key,auth_user_id uuid references auth.users(id),status text,recovery_deadline timestamptz,purge_completed_at timestamptz,requested_at timestamptz,reactivated_at timestamptz);
create table public.subscription_cancellation_retentions(id uuid primary key,auth_user_id uuid references auth.users(id),state text,paid_access_ends_at timestamptz,retention_until timestamptz,day_0_notification_due_at timestamptz,day_30_notification_due_at timestamptz,day_45_notification_due_at timestamptz,day_55_notification_due_at timestamptz);
create table public.subscription_payment_delinquencies(id uuid primary key,auth_user_id uuid references auth.users(id),state text,retention_started_at timestamptz,retention_until timestamptz,day_0_notification_due_at timestamptz,day_30_notification_due_at timestamptz,day_45_notification_due_at timestamptz,day_55_notification_due_at timestamptz);
insert into auth.users values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
-- Completed before Phase 9 exists: Phase 9 must backfill completion from evidence.
insert into public.account_deletion_requests(id,auth_user_id,status,recovery_deadline,purge_completed_at,requested_at)
values('19000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed',now()-interval '1 day',now()-interval '1 hour',now()-interval '61 days');
