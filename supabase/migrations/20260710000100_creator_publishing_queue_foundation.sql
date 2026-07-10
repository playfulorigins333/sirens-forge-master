-- Creator Publishing Queue foundation
-- Platform-agnostic manual handoff schema. No platform credentials, sessions,
-- cookies, API clients, automation, or remote URL validation are introduced here.

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.creator_publishing_queue_jsonb_has_forbidden_credential_key(value jsonb)
returns boolean
language sql
immutable
as $$
  with recursive walk(key, val) as (
    select null::text, value
    union all
    select child.key, child.value
    from walk
    cross join lateral jsonb_each(case when jsonb_typeof(walk.val) = 'object' then walk.val else '{}'::jsonb end) as child
    union all
    select null::text, elem.value
    from walk
    cross join lateral jsonb_array_elements(case when jsonb_typeof(walk.val) = 'array' then walk.val else '[]'::jsonb end) as elem(value)
  )
  select exists (
    select 1
    from walk
    where lower(coalesce(key, '')) in (
      'password','access_token','refresh_token','auth_token','session','session_id',
      'cookie','cookies','two_factor_secret','recovery_code','platform_secret'
    )
  );
$$;

create table if not exists public.creator_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('onlyfans','fansly','fanvue')),
  platform_username text not null,
  profile_url text,
  verification_status text not null default 'unattested' check (verification_status in ('unattested','creator_attested','revoked')),
  verification_attested_at timestamptz,
  is_virtual_entity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_platform_accounts_username_not_blank check (length(btrim(platform_username)) > 0),
  constraint creator_platform_accounts_id_creator_platform_unique unique (id, creator_id, platform)
);

create unique index if not exists creator_platform_accounts_creator_platform_username_uidx
  on public.creator_platform_accounts(creator_id, platform, lower(platform_username));

create table if not exists public.creator_publishing_content_packages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  platform_account_id uuid not null,
  target_platform text not null check (target_platform in ('onlyfans','fansly','fanvue')),
  title text not null,
  caption_body text not null,
  forced_disclosure_text text,
  ai_flag text not null default 'none' check (ai_flag in ('none','ai_enhanced','ai_generated')),
  ai_detail jsonb not null default '{}'::jsonb,
  second_person_present boolean not null default false,
  price_notes text,
  visibility_notes text,
  compliance_status text not null default 'pending' check (compliance_status in ('pending','passed','manual_review','blocked','escalated_approved')),
  compliance_policy_version text not null default 'unassigned',
  creator_approval_status text not null default 'pending' check (creator_approval_status in ('pending','approved','rejected')),
  creator_approved_at timestamptz,
  creator_approved_by uuid references auth.users(id) on delete set null,
  scheduled_for timestamptz,
  schedule_timezone text,
  platform_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_content_not_approved_when_blocked_or_pending check (
    creator_approval_status <> 'approved' or compliance_status not in ('blocked','pending')
  ),
  constraint creator_publishing_content_platform_meta_no_credentials check (
    not public.creator_publishing_queue_jsonb_has_forbidden_credential_key(platform_meta)
  ),
  constraint creator_publishing_content_platform_account_fk foreign key (platform_account_id, creator_id, target_platform)
    references public.creator_platform_accounts(id, creator_id, platform)
    on delete restrict
);


create or replace function public.creator_publishing_prevent_creator_controlled_field_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and tg_op = 'INSERT' then
    new.compliance_status = 'pending';
    new.compliance_policy_version = 'unassigned';
    new.forced_disclosure_text = null;
    new.creator_approval_status = 'pending';
    new.creator_approved_by = null;
    new.creator_approved_at = null;
    return new;
  end if;

  if current_user in ('authenticated', 'anon') and tg_op = 'UPDATE' and (
    old.compliance_status is distinct from new.compliance_status or
    old.compliance_policy_version is distinct from new.compliance_policy_version or
    old.forced_disclosure_text is distinct from new.forced_disclosure_text or
    old.creator_approval_status is distinct from new.creator_approval_status or
    old.creator_approved_by is distinct from new.creator_approved_by or
    old.creator_approved_at is distinct from new.creator_approved_at
  ) then
    raise exception 'content package compliance and approval controlled fields require service/admin workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_creator_publishing_prevent_creator_controlled_field_update on public.creator_publishing_content_packages;
create trigger trg_creator_publishing_prevent_creator_controlled_field_update
before insert or update on public.creator_publishing_content_packages
for each row execute function public.creator_publishing_prevent_creator_controlled_field_update();

create table if not exists public.creator_publishing_media_assets (
  id uuid primary key default gen_random_uuid(),
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  storage_key text not null,
  mime_type text not null,
  sha256 text not null,
  source text not null check (source in ('camera_upload','ai_pipeline','edited')),
  ai_generation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint creator_publishing_media_sha256_format check (sha256 ~ '^[a-fA-F0-9]{64}$')
);

create table if not exists public.creator_publishing_queue_tasks (
  id uuid primary key default gen_random_uuid(),
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','needs_compliance_review','needs_creator_approval','ready_for_handoff','scheduled_internally','due_now','claimed','confirmed_posted_manual','skipped','failed_manual_upload','needs_fix','blocked','archived')),
  due_at timestamptz,
  assigned_operator_id uuid references auth.users(id) on delete set null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  posted_confirmation boolean not null default false,
  final_post_url text,
  final_post_url_skip_reason text,
  proof_screenshot_storage_key text,
  skip_or_fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_queue_confirmed_requires_confirmation check (
    status <> 'confirmed_posted_manual' or posted_confirmation is true
  ),
  constraint creator_publishing_queue_confirmed_requires_url_or_skip check (
    status <> 'confirmed_posted_manual' or final_post_url is not null or final_post_url_skip_reason is not null
  )
);

create table if not exists public.creator_publishing_compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('pass','block','escalate')),
  notes text,
  escalated_approval_reason text,
  rule_hits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint creator_publishing_review_escalate_requires_reason check (
    outcome <> 'escalate' or length(btrim(coalesce(escalated_approval_reason, ''))) > 0
  )
);

create or replace function public.creator_publishing_escalated_approved_has_review()
returns trigger
language plpgsql
as $$
begin
  if new.compliance_status = 'escalated_approved' and not exists (
    select 1 from public.creator_publishing_compliance_reviews r
    where r.content_package_id = new.id
      and r.outcome = 'escalate'
      and length(btrim(coalesce(r.escalated_approval_reason, ''))) > 0
  ) then
    raise exception 'escalated_approved requires an escalate compliance review with a reason';
  end if;
  return new;
end;
$$;

create trigger trg_creator_publishing_escalated_approved_has_review
before insert or update of compliance_status on public.creator_publishing_content_packages
for each row execute function public.creator_publishing_escalated_approved_has_review();

create table if not exists public.creator_publishing_co_performer_records (
  id uuid primary key default gen_random_uuid(),
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  person_name text not null,
  release_document_reference text not null,
  platform_release_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint creator_publishing_co_performer_name_not_blank check (length(btrim(person_name)) > 0)
);

create table if not exists public.creator_publishing_audit_events (
  id bigserial primary key,
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.creator_publishing_audit_events_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'creator_publishing_audit_events is append-only';
end;
$$;

drop trigger if exists trg_creator_publishing_audit_events_no_update on public.creator_publishing_audit_events;
create trigger trg_creator_publishing_audit_events_no_update
before update on public.creator_publishing_audit_events
for each row execute function public.creator_publishing_audit_events_prevent_mutation();

drop trigger if exists trg_creator_publishing_audit_events_no_delete on public.creator_publishing_audit_events;
create trigger trg_creator_publishing_audit_events_no_delete
before delete on public.creator_publishing_audit_events
for each row execute function public.creator_publishing_audit_events_prevent_mutation();

create index if not exists creator_publishing_content_creator_idx on public.creator_publishing_content_packages(creator_id);
create index if not exists creator_publishing_media_content_idx on public.creator_publishing_media_assets(content_package_id);
create index if not exists creator_publishing_queue_content_idx on public.creator_publishing_queue_tasks(content_package_id);
create index if not exists creator_publishing_reviews_content_idx on public.creator_publishing_compliance_reviews(content_package_id);
create index if not exists creator_publishing_audit_entity_idx on public.creator_publishing_audit_events(entity_type, entity_id, created_at);

drop trigger if exists trg_creator_platform_accounts_updated_at on public.creator_platform_accounts;
create trigger trg_creator_platform_accounts_updated_at before update on public.creator_platform_accounts for each row execute function public.set_updated_at();
drop trigger if exists trg_creator_publishing_content_updated_at on public.creator_publishing_content_packages;
create trigger trg_creator_publishing_content_updated_at before insert or update on public.creator_publishing_content_packages for each row execute function public.set_updated_at();
drop trigger if exists trg_creator_publishing_queue_updated_at on public.creator_publishing_queue_tasks;
create trigger trg_creator_publishing_queue_updated_at before update on public.creator_publishing_queue_tasks for each row execute function public.set_updated_at();

alter table public.creator_platform_accounts enable row level security;
alter table public.creator_publishing_content_packages enable row level security;
alter table public.creator_publishing_media_assets enable row level security;
alter table public.creator_publishing_queue_tasks enable row level security;
alter table public.creator_publishing_compliance_reviews enable row level security;
alter table public.creator_publishing_co_performer_records enable row level security;
alter table public.creator_publishing_audit_events enable row level security;

create policy "creator_platform_accounts_select_own" on public.creator_platform_accounts for select using (auth.uid() = creator_id);
create policy "creator_platform_accounts_insert_own" on public.creator_platform_accounts for insert with check (auth.uid() = creator_id);
create policy "creator_platform_accounts_update_own" on public.creator_platform_accounts for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "creator_publishing_content_select_own" on public.creator_publishing_content_packages for select using (auth.uid() = creator_id);
create policy "creator_publishing_content_insert_own" on public.creator_publishing_content_packages for insert with check (auth.uid() = creator_id);
create policy "creator_publishing_content_update_own" on public.creator_publishing_content_packages for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "creator_publishing_media_select_own" on public.creator_publishing_media_assets for select using (exists (select 1 from public.creator_publishing_content_packages p where p.id = content_package_id and p.creator_id = auth.uid()));
create policy "creator_publishing_queue_select_own" on public.creator_publishing_queue_tasks for select using (exists (select 1 from public.creator_publishing_content_packages p where p.id = content_package_id and p.creator_id = auth.uid()));
create policy "creator_publishing_reviews_select_own" on public.creator_publishing_compliance_reviews for select using (exists (select 1 from public.creator_publishing_content_packages p where p.id = content_package_id and p.creator_id = auth.uid()));
create policy "creator_publishing_co_performers_select_own" on public.creator_publishing_co_performer_records for select using (exists (select 1 from public.creator_publishing_content_packages p where p.id = content_package_id and p.creator_id = auth.uid()));
create policy "creator_publishing_audit_events_select_actor" on public.creator_publishing_audit_events for select using (auth.uid() = actor_id);

comment on table public.creator_publishing_media_assets is 'Task 1 foundation: authenticated users may read their own package media metadata; writes are intentionally service-role-only until a controlled media workflow is introduced.';
comment on table public.creator_publishing_queue_tasks is 'Task 1 foundation: authenticated users may read their own package queue tasks; inserts/updates are intentionally service-role-only to prevent forged operator claims or manual posting confirmation.';
comment on table public.creator_publishing_compliance_reviews is 'Task 1 foundation: authenticated users may read their own package compliance reviews; writes are intentionally service-role-only to prevent creator-forged reviews.';
comment on table public.creator_publishing_co_performer_records is 'Supplemental Sirens Forge co-performer records; these do not replace platform-required release or verification flows. Task 1 writes are intentionally service-role-only until a controlled release workflow is introduced.';
comment on table public.creator_publishing_audit_events is 'Task 1 foundation: append-only audit events; authenticated users may read their own actor events, while inserts are intentionally service-role-only to prevent forged actor identity.';
comment on column public.creator_publishing_queue_tasks.final_post_url is 'Human-entered string only. Do not fetch, preview, HEAD, scrape, or live-validate this URL.';
