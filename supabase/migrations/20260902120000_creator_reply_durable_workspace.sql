-- Phase 6F.2: private, multi-tenant Creator Reply durable state.
create table public.sirens_mind_creator_reply_workspaces (
  id uuid primary key default gen_random_uuid(), created_by_user_id uuid not null references auth.users(id),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sirens_mind_creator_reply_workspace_members (
  workspace_id uuid not null references public.sirens_mind_creator_reply_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')), created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create table public.sirens_mind_creator_reply_subscribers (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.sirens_mind_creator_reply_workspaces(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id), display_name text not null check (display_name=btrim(display_name) and char_length(display_name) between 1 and 120),
  platform text not null check (platform=btrim(platform) and char_length(platform) between 1 and 80),
  platform_handle text check (platform_handle is null or char_length(platform_handle)<=120), notes_ciphertext text, notes_key_version integer check (notes_key_version is null or notes_key_version>0),
  last_used_at timestamptz, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);
create table public.sirens_mind_creator_reply_conversations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, subscriber_id uuid not null,
  created_by_user_id uuid not null references auth.users(id), thread_id uuid not null unique default gen_random_uuid(),
  status text not null check (status in ('active','paused','archived')), checkpoint_ciphertext text not null,
  checkpoint_key_version integer not null check (checkpoint_key_version>0), checkpoint_revision bigint not null default 0 check (checkpoint_revision>=0),
  started_at timestamptz not null default now(), last_used_at timestamptz, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id,subscriber_id) references public.sirens_mind_creator_reply_subscribers(workspace_id,id) on delete cascade
);
create unique index sirens_mind_creator_reply_one_active on public.sirens_mind_creator_reply_conversations(subscriber_id) where status='active';
create index sirens_mind_creator_reply_subscribers_recent on public.sirens_mind_creator_reply_subscribers(workspace_id,last_used_at desc nulls last,updated_at desc);
create index sirens_mind_creator_reply_conversations_subscriber on public.sirens_mind_creator_reply_conversations(workspace_id,subscriber_id,updated_at desc);
alter table public.sirens_mind_creator_reply_workspaces enable row level security;
alter table public.sirens_mind_creator_reply_workspace_members enable row level security;
alter table public.sirens_mind_creator_reply_subscribers enable row level security;
alter table public.sirens_mind_creator_reply_conversations enable row level security;
revoke all on public.sirens_mind_creator_reply_workspaces, public.sirens_mind_creator_reply_workspace_members,
  public.sirens_mind_creator_reply_subscribers, public.sirens_mind_creator_reply_conversations from anon, authenticated;
