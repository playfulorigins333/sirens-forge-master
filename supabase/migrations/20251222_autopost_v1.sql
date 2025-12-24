-- SirensForge Autopost v1 (Launch)
-- Tables:
--   autopost_accounts  (per-user connected platform accounts, tokens stored encrypted or via provider vault)
--   autopost_rules     (rule config + approval state + 80/20 contract acceptance)
--   autopost_jobs      (scheduled executions)
--   autopost_job_logs  (audit trail)

-- NOTE: If you already have RLS / auth patterns, adjust policies accordingly.
-- This is launch-safe: strict per-user access + server-only service role writes for jobs.

create table if not exists public.autopost_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('fanvue','onlyfans','fansly','loyalfans','justforfans','x','reddit')),
  display_name text,
  -- Store provider tokens in a secure vault if possible.
  -- If you must store here, encrypt at rest with pgcrypto and rotate keys.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create index if not exists autopost_accounts_user_id_idx on public.autopost_accounts(user_id);

create table if not exists public.autopost_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- config
  enabled boolean not null default false,
  selected_platforms jsonb not null default '[]'::jsonb,
  explicitness int not null default 1,
  tones jsonb not null default '[]'::jsonb,

  -- scheduling (user-defined)
  timezone text not null default 'America/New_York',
  start_date date,
  end_date date,
  posts_per_day int not null default 0,
  time_slots jsonb not null default '[]'::jsonb, -- e.g. ["09:30","13:00","18:45"]

  -- approval contract (LOCKED: approval happens once per rule)
  approval_state text not null default 'DRAFT' check (approval_state in ('DRAFT','APPROVED','PAUSED','REVOKED')),
  approved_at timestamptz,
  paused_at timestamptz,
  revoked_at timestamptz,

  -- contract acceptance flags (must be true to approve)
  accept_split boolean not null default false,
  accept_automation boolean not null default false,
  accept_control boolean not null default false,

  -- revenue split (locked at 80/20 for launch)
  creator_pct int not null default 80,
  platform_pct int not null default 20,

  -- runner bookkeeping
  next_run_at timestamptz,
  last_run_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopost_rules_user_id_idx on public.autopost_rules(user_id);
create index if not exists autopost_rules_next_run_idx on public.autopost_rules(next_run_at);

create table if not exists public.autopost_jobs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.autopost_rules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  state text not null default 'QUEUED' check (state in ('QUEUED','RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  platform text,
  payload jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopost_jobs_rule_id_idx on public.autopost_jobs(rule_id);
create index if not exists autopost_jobs_user_id_idx on public.autopost_jobs(user_id);
create index if not exists autopost_jobs_state_idx on public.autopost_jobs(state);
create index if not exists autopost_jobs_scheduled_for_idx on public.autopost_jobs(scheduled_for);

create table if not exists public.autopost_job_logs (
  id bigserial primary key,
  job_id uuid not null references public.autopost_jobs(id) on delete cascade,
  level text not null default 'INFO' check (level in ('DEBUG','INFO','WARN','ERROR')),
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- Updated_at triggers
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_autopost_accounts_updated_at on public.autopost_accounts;
create trigger trg_autopost_accounts_updated_at
before update on public.autopost_accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_autopost_rules_updated_at on public.autopost_rules;
create trigger trg_autopost_rules_updated_at
before update on public.autopost_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_autopost_jobs_updated_at on public.autopost_jobs;
create trigger trg_autopost_jobs_updated_at
before update on public.autopost_jobs
for each row execute function public.set_updated_at();

-- RLS (client should only read/write its own rules; jobs are mostly server-managed)
alter table public.autopost_accounts enable row level security;
alter table public.autopost_rules enable row level security;
alter table public.autopost_jobs enable row level security;
alter table public.autopost_job_logs enable row level security;

-- Accounts
drop policy if exists "autopost_accounts_select_own" on public.autopost_accounts;
create policy "autopost_accounts_select_own"
on public.autopost_accounts for select
using (auth.uid() = user_id);

drop policy if exists "autopost_accounts_update_own" on public.autopost_accounts;
create policy "autopost_accounts_update_own"
on public.autopost_accounts for update
using (auth.uid() = user_id);

drop policy if exists "autopost_accounts_insert_own" on public.autopost_accounts;
create policy "autopost_accounts_insert_own"
on public.autopost_accounts for insert
with check (auth.uid() = user_id);

-- Rules
drop policy if exists "autopost_rules_select_own" on public.autopost_rules;
create policy "autopost_rules_select_own"
on public.autopost_rules for select
using (auth.uid() = user_id);

drop policy if exists "autopost_rules_insert_own" on public.autopost_rules;
create policy "autopost_rules_insert_own"
on public.autopost_rules for insert
with check (auth.uid() = user_id);

drop policy if exists "autopost_rules_update_own" on public.autopost_rules;
create policy "autopost_rules_update_own"
on public.autopost_rules for update
using (auth.uid() = user_id);

-- Jobs: allow users to view their own jobs; inserts/updates should be service role
drop policy if exists "autopost_jobs_select_own" on public.autopost_jobs;
create policy "autopost_jobs_select_own"
on public.autopost_jobs for select
using (auth.uid() = user_id);

-- Logs: allow users to view logs for their own jobs
drop policy if exists "autopost_job_logs_select_own" on public.autopost_job_logs;
create policy "autopost_job_logs_select_own"
on public.autopost_job_logs for select
using (
  exists (
    select 1 from public.autopost_jobs j
    where j.id = autopost_job_logs.job_id
      and j.user_id = auth.uid()
  )
);
