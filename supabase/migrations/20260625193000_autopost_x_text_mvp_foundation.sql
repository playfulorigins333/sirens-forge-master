-- SirensForge Autopost X text-only MVP foundation
-- Purpose:
--   - Prepare account metadata for X OAuth without using legacy raw token columns.
--   - Add text-only content persistence on autopost_rules.
--   - Add durable job/result proof fields for future strict scheduled posting.
--   - Align future run execution with autopost_jobs/autopost_job_logs, not autopost_runs.

-- -----------------------------------------------------------------------------
-- A. Account metadata + encrypted/vault-referenced provider credentials
-- -----------------------------------------------------------------------------
alter table public.autopost_accounts
  add column if not exists provider_account_id text,
  add column if not exists provider_username text,
  add column if not exists token_type text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists scopes jsonb not null default '[]'::jsonb,
  add column if not exists encrypted_access_token text,
  add column if not exists encrypted_refresh_token text,
  add column if not exists token_key_version int not null default 1,
  add column if not exists connection_status text not null default 'DISCONNECTED',
  add column if not exists connected_at timestamptz,
  add column if not exists last_refresh_at timestamptz,
  add column if not exists last_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'autopost_accounts_connection_status_check'
      and conrelid = 'public.autopost_accounts'::regclass
  ) then
    alter table public.autopost_accounts
      add constraint autopost_accounts_connection_status_check
      check (connection_status in ('CONNECTED','DISCONNECTED','EXPIRED','REVOKED','ERROR'));
  end if;
end $$;

comment on column public.autopost_accounts.provider_account_id is
  'Provider account id returned by the connected platform, such as X user id.';
comment on column public.autopost_accounts.provider_username is
  'Provider username/handle for display only; not proof of connection by itself.';
comment on column public.autopost_accounts.scopes is
  'OAuth scopes granted for the connected provider account.';
comment on column public.autopost_accounts.encrypted_access_token is
  'Server-side encrypted or vault-referenced provider access token. Do not expose to clients.';
comment on column public.autopost_accounts.encrypted_refresh_token is
  'Server-side encrypted or vault-referenced provider refresh token. Do not expose to clients.';
comment on column public.autopost_accounts.token_key_version is
  'Encryption key version used for encrypted provider credential columns.';
comment on column public.autopost_accounts.token_expires_at is
  'OAuth access token expiration time used by the X adapter to avoid posting with expired provider tokens.';
comment on column public.autopost_accounts.connection_status is
  'Provider connection lifecycle state for launch-safe platform availability checks.';
comment on column public.autopost_accounts.access_token is
  'Legacy raw token column. Must not be used for X launch; use encrypted_access_token or a vault reference instead.';
comment on column public.autopost_accounts.refresh_token is
  'Legacy raw token column. Must not be used for X launch; use encrypted_refresh_token or a vault reference instead.';

-- -----------------------------------------------------------------------------
-- B. Rule content payload for text-only X Autopost MVP
-- -----------------------------------------------------------------------------
alter table public.autopost_rules
  add column if not exists content_payload jsonb not null default '{}'::jsonb;

comment on column public.autopost_rules.content_payload is
  'MVP storage for text-only X Autopost content and metadata such as platform, text, source, generation ids, caption draft id, asset metadata, and hashtags. Asset URLs are metadata only and are not posted as media in the text-only MVP.';

-- -----------------------------------------------------------------------------
-- C. Job/result proof, locking, and retry metadata
-- -----------------------------------------------------------------------------
alter table public.autopost_jobs
  add column if not exists result_status text,
  add column if not exists platform_post_id text,
  add column if not exists external_job_id text,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists attempt_count int not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_id text,
  add column if not exists posted_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'autopost_jobs_result_status_check'
      and conrelid = 'public.autopost_jobs'::regclass
  ) then
    alter table public.autopost_jobs
      add constraint autopost_jobs_result_status_check
      check (result_status in ('PENDING','POSTED','DISPATCHED','FAILED','NOT_CONFIGURED','UNSUPPORTED','ASSISTED_READY'));
  end if;
end $$;

comment on column public.autopost_jobs.result_status is
  'Strict platform result status. POSTED requires a real platform-returned proof id. ASSISTED_READY must not count as posted.';
comment on column public.autopost_jobs.platform_post_id is
  'Real platform-returned post id only, such as X data.id. Never store fabricated ids here.';
comment on column public.autopost_jobs.external_job_id is
  'External async dispatch job id if a future worker model is used; not proof of posting by itself.';
comment on column public.autopost_jobs.error_code is
  'Stable machine-readable adapter or execution error code.';
comment on column public.autopost_jobs.error_message is
  'Human-readable adapter or execution error message without secrets.';
comment on column public.autopost_jobs.attempt_count is
  'Number of execution attempts for retry/backoff handling.';
comment on column public.autopost_jobs.locked_at is
  'Timestamp when a runner locked the job to prevent duplicate dispatch.';
comment on column public.autopost_jobs.lock_id is
  'Runner lock token used to coordinate safe job execution.';
comment on column public.autopost_jobs.posted_at is
  'Timestamp when the platform confirmed a real posted result.';
comment on column public.autopost_jobs.next_attempt_at is
  'Timestamp after which a failed/retryable job may be attempted again.';
comment on column public.autopost_jobs.completed_at is
  'Timestamp when the job reached a terminal result state.';

-- -----------------------------------------------------------------------------
-- D. Indexes for locking and proof lookup
-- -----------------------------------------------------------------------------
create index if not exists autopost_jobs_lock_idx
  on public.autopost_jobs(state, locked_at);

create index if not exists autopost_jobs_platform_post_id_idx
  on public.autopost_jobs(platform, platform_post_id);

-- Prevent duplicate scheduled work for the same rule/platform/time slot before
-- future runners lock and dispatch jobs. This is safe because scheduled_for is
-- required by the existing autopost_jobs schema.
create unique index if not exists autopost_jobs_rule_platform_scheduled_for_uidx
  on public.autopost_jobs(rule_id, platform, scheduled_for);
