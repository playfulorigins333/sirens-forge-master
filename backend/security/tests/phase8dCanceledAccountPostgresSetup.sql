\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create schema if not exists auth;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end$$;

create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key,user_id uuid unique references auth.users(id),account_lifecycle_state text default 'active');
create table public.user_subscriptions(
  id uuid primary key,user_id uuid not null references public.profiles(id),status text not null,
  tier_name text,stripe_subscription_id text,current_period_end timestamptz,cancel_at_period_end boolean default false,
  created_at timestamptz default now(),updated_at timestamptz default now()
);

create table public.retention_policy_versions(
  id uuid primary key default gen_random_uuid(),policy_key text not null,policy_version integer not null,
  subject_type text not null,retention_duration interval not null,purge_mode text not null,
  policy_document_version text not null,effective_at timestamptz not null,retired_at timestamptz,
  unique(policy_key,policy_version)
);
insert into public.retention_policy_versions(policy_key,policy_version,subject_type,retention_duration,purge_mode,policy_document_version,effective_at)
values ('subscription_cancellation',1,'subscription_cancellation',interval '60 days','automatic','test-policy',now()-interval '1 day');

create or replace function public.current_retention_policy(p_policy_key text,p_at timestamptz default statement_timestamp())
returns public.retention_policy_versions
language sql stable security invoker set search_path=pg_catalog
as $$
  select r from public.retention_policy_versions r
  where r.policy_key=p_policy_key and r.effective_at<=p_at and (r.retired_at is null or r.retired_at>p_at)
  order by r.policy_version desc limit 1
$$;

create table public.governance_test_holds(target_type text,target_id text,subject_user_id uuid,primary key(target_type,target_id,subject_user_id));
create or replace function public.governance_target_has_active_legal_hold(p_target_type text,p_target_id text,p_subject_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $$select exists(select 1 from public.governance_test_holds h where h.target_type=p_target_type and h.target_id=p_target_id and h.subject_user_id=p_subject_user_id)$$;

create table public.governance_audit_events(id uuid primary key default gen_random_uuid(),action text,target_type text,target_id text,created_at timestamptz default now());
create or replace function public.append_governance_audit_event(
  p_actor_user_id uuid,p_actor_type text,p_action text,p_target_type text,p_target_id text,
  p_reason_category text,p_reason text,p_result text,p_policy_version text,p_form_version text,
  p_correlation_id uuid,p_request_id text,p_facts jsonb,p_references jsonb,p_correction_of uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$declare v_id uuid:=gen_random_uuid(); begin insert into public.governance_audit_events(id,action,target_type,target_id) values(v_id,p_action,p_target_type,p_target_id); return v_id; end$$;

create or replace function public.phase8_minimized_generation_metadata(p_metadata jsonb)
returns jsonb language sql immutable as $$select coalesce(p_metadata,'{}'::jsonb)-'prompt'-'negative_prompt'-'content'-'request'$$;

create table public.content_posts(id uuid primary key default gen_random_uuid(),user_id uuid not null,status text not null default 'draft');
create table public.collections(id uuid primary key default gen_random_uuid(),user_id uuid not null,name text not null);
create table public.generations(
  id uuid primary key default gen_random_uuid(),user_id uuid,prompt text,negative_prompt text,image_url text,lora_used text,
  body_type text,metadata jsonb default '{}'::jsonb,r2_bucket text,r2_key text,runpod_job_id text,error_message text,updated_at timestamptz default now()
);
create table public.generation_assets(id uuid primary key default gen_random_uuid(),generation_id uuid not null,owner_id uuid not null,lifecycle_state text not null default 'active');
create table public.user_loras(
  id uuid primary key default gen_random_uuid(),user_id uuid,lifecycle_state text not null default 'active',training_data_state text not null default 'active'
);

grant usage on schema public to anon,authenticated,service_role;
