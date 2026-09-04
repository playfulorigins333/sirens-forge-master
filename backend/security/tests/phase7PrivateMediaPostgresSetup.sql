\set ON_ERROR_STOP on
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table auth.users(id uuid primary key);
create table public.generations(id uuid primary key default gen_random_uuid(),user_id uuid not null,prompt text,image_url text,lora_used text,job_type text,body_type text,mode text,status text,negative_prompt text,steps integer,cfg_scale numeric,seed bigint,width integer,height integer,runpod_job_id text,processing_time_ms integer,completed_at timestamptz,metadata jsonb,r2_bucket text,r2_key text,updated_at timestamptz,created_at timestamptz default now());
create table public.creator_publishing_content_packages(id uuid primary key,creator_id uuid not null,target_platform text not null default 'onlyfans',creator_approval_status text not null default 'pending');
create table public.creator_publishing_queue_tasks(id uuid primary key default gen_random_uuid(),content_package_id uuid,status text);
create table public.creator_publishing_media_assets(id uuid primary key default gen_random_uuid(),content_package_id uuid not null,storage_key text not null,mime_type text not null,sha256 text not null,source text not null,ai_generation_metadata jsonb not null default '{}',created_at timestamptz default now());
create table public.creator_publishing_audit_events(id bigserial primary key,entity_type text,entity_id uuid,actor_id uuid,actor_role text,action text,before_state jsonb,after_state jsonb,idempotency_key text unique,created_at timestamptz);
