create table if not exists public.creator_publishing_media_upload_intents (
  id uuid primary key,
  reserved_media_asset_id uuid not null,
  creator_id uuid not null references auth.users(id),
  content_package_id uuid not null references public.creator_publishing_content_packages(id) on delete cascade,
  storage_key text not null,
  mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('camera_upload','edited')),
  status text not null check (status in ('pending','completed','failed','expired')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint creator_publishing_media_upload_intents_storage_key_nonblank check (length(btrim(storage_key)) > 0),
  constraint creator_publishing_media_upload_intents_completed_at_required check (status <> 'completed' or completed_at is not null),
  constraint creator_publishing_media_upload_intents_failed_at_required check (status not in ('failed','expired') or failed_at is not null),
  constraint creator_publishing_media_upload_intents_reserved_asset_unique unique (reserved_media_asset_id),
  constraint creator_publishing_media_upload_intents_storage_key_unique unique (storage_key)
);

create unique index if not exists creator_publishing_media_assets_storage_key_uidx on public.creator_publishing_media_assets(storage_key);
create index if not exists creator_publishing_media_upload_intents_creator_idx on public.creator_publishing_media_upload_intents(creator_id, status, expires_at);
alter table public.creator_publishing_media_upload_intents enable row level security;

comment on table public.creator_publishing_media_upload_intents is 'Temporary service-role-only reservations for controlled private browser uploads. Signed upload credentials are never stored; browser clients cannot choose the Storage path; ai_pipeline remains reserved for trusted generation services.';
comment on column public.creator_publishing_media_upload_intents.storage_key is 'Server-reserved private Storage object path. The browser must not supply or replace it.';
comment on column public.creator_publishing_media_upload_intents.source is 'Browser upload sources are camera_upload or edited only; ai_pipeline is reserved for trusted generation services.';
comment on column public.creator_publishing_media_upload_intents.expected_sha256 is 'Client-computed immutable manifest digest, not a server-attested checksum.';

create or replace function public.creator_publishing_complete_media_upload(p_upload_intent_id uuid, p_creator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_intent public.creator_publishing_media_upload_intents%rowtype;
  v_package public.creator_publishing_content_packages%rowtype;
  v_asset public.creator_publishing_media_assets%rowtype;
  v_audit_id bigint;
begin
  select * into v_intent from public.creator_publishing_media_upload_intents where id = p_upload_intent_id for update;
  if not found or v_intent.creator_id <> p_creator_id then raise exception 'NOT_FOUND'; end if;

  if v_intent.status = 'completed' then
    select * into v_asset from public.creator_publishing_media_assets where id = v_intent.reserved_media_asset_id;
    return jsonb_build_object('media_asset', to_jsonb(v_asset), 'audit_event_ids', '[]'::jsonb, 'idempotent', true);
  end if;
  if v_intent.status in ('failed','expired') then raise exception 'UPLOAD_INTENT_FAILED'; end if;
  if v_intent.expires_at <= now() then
    update public.creator_publishing_media_upload_intents set status = 'expired', failed_at = now(), failure_code = 'UPLOAD_INTENT_EXPIRED' where id = v_intent.id;
    raise exception 'UPLOAD_INTENT_EXPIRED';
  end if;

  select * into v_package from public.creator_publishing_content_packages where id = v_intent.content_package_id for update;
  if not found or v_package.creator_id <> p_creator_id then raise exception 'NOT_FOUND'; end if;
  if v_package.target_platform = 'fanvue' then raise exception 'NOT_FOUND'; end if;
  if v_package.creator_approval_status = 'approved' then raise exception 'PACKAGE_LOCKED'; end if;
  if exists (select 1 from public.creator_publishing_queue_tasks where content_package_id = v_package.id and status <> 'archived') then raise exception 'PACKAGE_LOCKED'; end if;

  insert into public.creator_publishing_media_assets(id, content_package_id, storage_key, mime_type, sha256, source, ai_generation_metadata, created_at)
  values (v_intent.reserved_media_asset_id, v_intent.content_package_id, v_intent.storage_key, v_intent.mime_type, v_intent.expected_sha256, v_intent.source, '{}'::jsonb, now())
  on conflict (id) do nothing
  returning * into v_asset;
  if v_asset.id is null then select * into v_asset from public.creator_publishing_media_assets where id = v_intent.reserved_media_asset_id; end if;

  update public.creator_publishing_media_upload_intents set status = 'completed', completed_at = now() where id = v_intent.id and status = 'pending';

  insert into public.creator_publishing_audit_events(entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, idempotency_key, created_at)
  values ('creator_publishing_media_asset', v_asset.id, p_creator_id, 'creator', 'creator_publishing_media_asset_registered', '{}'::jsonb,
    jsonb_build_object('content_package_id', v_intent.content_package_id, 'storage_key', v_intent.storage_key, 'mime_type', v_intent.mime_type, 'sha256', v_intent.expected_sha256, 'source', v_intent.source), v_intent.id::text, now())
  on conflict (entity_type, entity_id, action, idempotency_key) do nothing
  returning id into v_audit_id;

  return jsonb_build_object('media_asset', to_jsonb(v_asset), 'audit_event_ids', case when v_audit_id is null then '[]'::jsonb else jsonb_build_array(v_audit_id) end, 'idempotent', false);
end;
$$;

revoke all on function public.creator_publishing_complete_media_upload(uuid, uuid) from PUBLIC;
revoke all on function public.creator_publishing_complete_media_upload(uuid, uuid) from anon;
revoke all on function public.creator_publishing_complete_media_upload(uuid, uuid) from authenticated;
grant execute on function public.creator_publishing_complete_media_upload(uuid, uuid) to service_role;
comment on function public.creator_publishing_complete_media_upload(uuid, uuid) is 'Service-role-only completion for controlled private uploads. Registers one media asset from a server-reserved intent and writes an append-only audit event without signed URL/token data.';
