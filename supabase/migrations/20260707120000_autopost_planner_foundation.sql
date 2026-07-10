-- Sirens Forge Autopost Planner Foundation
-- PR A: additive planner data model / UI contract
--
-- Safe migration notes:
-- - Existing public.content_posts table is empty.
-- - Existing public.content_posts belonged to old AI influencer concept.
-- - No rows were found in public.content_posts.
-- - No view dependencies were found for public.content_posts.
-- - This migration preserves the old table by renaming it instead of dropping it.
-- - New planner tables do not dispatch, post, call Fanvue, call X, call RunPod, or touch pods.
-- - This migration does NOT modify autopost_rules, autopost_jobs, autopost_accounts, or autopost_job_logs.

-- -----------------------------------------------------------------------------
-- 0. Preserve old AI influencer content_posts table, if it still exists
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_posts'
      and column_name = 'influencer_id'
  )
  and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'content_posts_legacy_ai_influencer'
  )
  then
    alter table public.content_posts
    rename to content_posts_legacy_ai_influencer;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- A. content_posts
-- One planned creator post.
-- -----------------------------------------------------------------------------

create table if not exists public.content_posts (
  id uuid default gen_random_uuid(),
  user_id uuid not null,

  title text,
  caption text not null default '',

  status text not null default 'draft',
  mode text not null default 'manual',

  timezone text not null default 'UTC',
  scheduled_for timestamptz,
  posted_at timestamptz,

  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_posts_planner_pkey
    primary key (id),

  constraint content_posts_planner_user_id_fkey
    foreign key (user_id)
    references auth.users(id)
    on delete cascade,

  constraint content_posts_planner_status_check
    check (status in ('draft','scheduled','ready_to_post','posted','needs_action','canceled')),

  constraint content_posts_planner_mode_check
    check (mode in ('manual','assisted','native_disabled','native_ready_later'))
);

create index if not exists content_posts_user_id_idx
  on public.content_posts(user_id);

create index if not exists content_posts_status_idx
  on public.content_posts(user_id, status);

create index if not exists content_posts_scheduled_for_idx
  on public.content_posts(user_id, scheduled_for);

-- -----------------------------------------------------------------------------
-- B. content_post_media
-- Media attached to a planned post.
-- -----------------------------------------------------------------------------

create table if not exists public.content_post_media (
  id uuid default gen_random_uuid(),
  post_id uuid not null,
  user_id uuid not null,

  generation_id uuid,
  media_url text not null,
  storage_key text,

  media_type text not null default 'image',

  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_post_media_pkey
    primary key (id),

  constraint content_post_media_post_id_fkey
    foreign key (post_id)
    references public.content_posts(id)
    on delete cascade,

  constraint content_post_media_user_id_fkey
    foreign key (user_id)
    references auth.users(id)
    on delete cascade,

  constraint content_post_media_type_check
    check (media_type in ('image','video','audio','other')),

  constraint content_post_media_post_sort_unique
    unique (post_id, sort_order)
);

create index if not exists content_post_media_post_id_idx
  on public.content_post_media(post_id);

create index if not exists content_post_media_user_id_idx
  on public.content_post_media(user_id);

create index if not exists content_post_media_generation_id_idx
  on public.content_post_media(generation_id);

-- -----------------------------------------------------------------------------
-- C. content_post_targets
-- Per-platform version of a planned post.
-- -----------------------------------------------------------------------------

create table if not exists public.content_post_targets (
  id uuid default gen_random_uuid(),
  post_id uuid not null,
  user_id uuid not null,

  platform text not null,
  platform_caption text,

  platform_status text not null default 'draft',
  platform_mode text not null default 'native_disabled',

  scheduled_for timestamptz,
  posted_at timestamptz,

  external_url text,
  external_post_id text,
  error_message text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_post_targets_pkey
    primary key (id),

  constraint content_post_targets_post_id_fkey
    foreign key (post_id)
    references public.content_posts(id)
    on delete cascade,

  constraint content_post_targets_user_id_fkey
    foreign key (user_id)
    references auth.users(id)
    on delete cascade,

  constraint content_post_targets_platform_check
    check (platform in ('x','fanvue','onlyfans','fansly')),

  constraint content_post_targets_status_check
    check (platform_status in ('draft','scheduled','ready_to_post','posted','needs_action','canceled')),

  constraint content_post_targets_mode_check
    check (platform_mode in ('manual','assisted','native_disabled','native_ready_later')),

  constraint content_post_targets_post_platform_unique
    unique (post_id, platform)
);

create index if not exists content_post_targets_post_id_idx
  on public.content_post_targets(post_id);

create index if not exists content_post_targets_user_id_idx
  on public.content_post_targets(user_id);

create index if not exists content_post_targets_platform_idx
  on public.content_post_targets(user_id, platform);

create index if not exists content_post_targets_status_idx
  on public.content_post_targets(user_id, platform_status);

create index if not exists content_post_targets_scheduled_for_idx
  on public.content_post_targets(user_id, scheduled_for);

-- -----------------------------------------------------------------------------
-- D. updated_at triggers
-- Uses public.set_updated_at(), which already exists in Supabase.
-- -----------------------------------------------------------------------------

drop trigger if exists trg_content_posts_updated_at on public.content_posts;
create trigger trg_content_posts_updated_at
before update on public.content_posts
for each row execute function public.set_updated_at();

drop trigger if exists trg_content_post_media_updated_at on public.content_post_media;
create trigger trg_content_post_media_updated_at
before update on public.content_post_media
for each row execute function public.set_updated_at();

drop trigger if exists trg_content_post_targets_updated_at on public.content_post_targets;
create trigger trg_content_post_targets_updated_at
before update on public.content_post_targets
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- E. Row Level Security
-- Own-row select / insert / update / delete.
-- -----------------------------------------------------------------------------

alter table public.content_posts enable row level security;
alter table public.content_post_media enable row level security;
alter table public.content_post_targets enable row level security;

-- content_posts policies

drop policy if exists "content_posts_select_own" on public.content_posts;
create policy "content_posts_select_own"
on public.content_posts
for select
using (auth.uid() = user_id);

drop policy if exists "content_posts_insert_own" on public.content_posts;
create policy "content_posts_insert_own"
on public.content_posts
for insert
with check (auth.uid() = user_id);

drop policy if exists "content_posts_update_own" on public.content_posts;
create policy "content_posts_update_own"
on public.content_posts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "content_posts_delete_own" on public.content_posts;
create policy "content_posts_delete_own"
on public.content_posts
for delete
using (auth.uid() = user_id);

-- content_post_media policies

drop policy if exists "content_post_media_select_own" on public.content_post_media;
create policy "content_post_media_select_own"
on public.content_post_media
for select
using (auth.uid() = user_id);

drop policy if exists "content_post_media_insert_own" on public.content_post_media;
create policy "content_post_media_insert_own"
on public.content_post_media
for insert
with check (auth.uid() = user_id);

drop policy if exists "content_post_media_update_own" on public.content_post_media;
create policy "content_post_media_update_own"
on public.content_post_media
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "content_post_media_delete_own" on public.content_post_media;
create policy "content_post_media_delete_own"
on public.content_post_media
for delete
using (auth.uid() = user_id);

-- content_post_targets policies

drop policy if exists "content_post_targets_select_own" on public.content_post_targets;
create policy "content_post_targets_select_own"
on public.content_post_targets
for select
using (auth.uid() = user_id);

drop policy if exists "content_post_targets_insert_own" on public.content_post_targets;
create policy "content_post_targets_insert_own"
on public.content_post_targets
for insert
with check (auth.uid() = user_id);

drop policy if exists "content_post_targets_update_own" on public.content_post_targets;
create policy "content_post_targets_update_own"
on public.content_post_targets
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "content_post_targets_delete_own" on public.content_post_targets;
create policy "content_post_targets_delete_own"
on public.content_post_targets
for delete
using (auth.uid() = user_id);