-- Phase 8C: Draft/Media library retention execution.
-- Production application requires separate explicit authorization.
--
-- Locked boundaries:
-- - planner content_posts drafts expire after 90 days of inactivity;
-- - edits and attached-media/target mutations reset the 90-day draft clock;
-- - non-draft planner posts are not subject to this draft policy;
-- - active generated Library media is not auto-purged;
-- - private generated media Trash keeps the existing 30-day retention window;
-- - governance legal holds always win;
-- - no Phase 9 notifications are added here.

begin;

insert into public.retention_policy_versions(
  policy_key, policy_version, subject_type, retention_duration,
  purge_mode, policy_document_version, effective_at
)
values (
  'planner_draft_inactivity',1,'planner_draft',interval '90 days',
  'automatic','retention-policy-2026-09-05-r1',statement_timestamp()
);

alter table public.content_posts
  add column draft_retention_expires_at timestamptz;

create index content_posts_draft_retention_due_idx
  on public.content_posts(draft_retention_expires_at,id)
  where status='draft';

create or replace function public.phase8c_set_planner_draft_retention()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_duration interval;
  v_now timestamptz := statement_timestamp();
begin
  if new.status <> 'draft' then
    new.draft_retention_expires_at := null;
    return new;
  end if;

  select retention_duration into v_duration
  from public.current_retention_policy('planner_draft_inactivity',v_now);
  if v_duration is null then raise exception 'PHASE8C_DRAFT_RETENTION_POLICY_MISSING'; end if;

  if tg_op='INSERT' or old.status <> 'draft' or new is distinct from old then
    new.draft_retention_expires_at := v_now + v_duration;
  end if;
  return new;
end;
$$;
revoke all on function public.phase8c_set_planner_draft_retention() from public,anon,authenticated,service_role;

drop trigger if exists phase8c_set_planner_draft_retention on public.content_posts;
create trigger phase8c_set_planner_draft_retention
before insert or update on public.content_posts
for each row execute function public.phase8c_set_planner_draft_retention();

create or replace function public.phase8c_touch_planner_draft_parent()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_post_id uuid := case when tg_op='DELETE' then old.post_id else new.post_id end;
begin
  update public.content_posts
     set updated_at=clock_timestamp()
   where id=v_post_id and status='draft';
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.phase8c_touch_planner_draft_parent() from public,anon,authenticated,service_role;

drop trigger if exists phase8c_touch_draft_from_media on public.content_post_media;
create trigger phase8c_touch_draft_from_media
after insert or update or delete on public.content_post_media
for each row execute function public.phase8c_touch_planner_draft_parent();

drop trigger if exists phase8c_touch_draft_from_target on public.content_post_targets;
create trigger phase8c_touch_draft_from_target
after insert or update or delete on public.content_post_targets
for each row execute function public.phase8c_touch_planner_draft_parent();

-- Existing drafts predate this policy. Their clock begins from their most recent known
-- mutation time, never from a fabricated earlier date.
update public.content_posts p
   set draft_retention_expires_at = greatest(p.created_at,p.updated_at) + interval '90 days'
 where p.status='draft' and p.draft_retention_expires_at is null;

create or replace function public.phase8c_purge_expired_planner_drafts(p_limit integer default 100)
returns table(purged_count integer, held_count integer)
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  r record;
  v_purged integer := 0;
  v_held integer := 0;
  v_audit_id uuid;
  v_correlation uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'PHASE8C_PURGE_LIMIT_INVALID';
  end if;

  for r in
    select id,user_id,draft_retention_expires_at
    from public.content_posts
    where status='draft'
      and draft_retention_expires_at is not null
      and draft_retention_expires_at <= statement_timestamp()
    order by draft_retention_expires_at,id
    for update skip locked
    limit p_limit
  loop
    if public.governance_target_has_active_legal_hold('content_post',r.id::text,r.user_id) then
      v_held := v_held + 1;
      continue;
    end if;

    v_correlation := gen_random_uuid();
    v_audit_id := public.append_governance_audit_event(
      null,'system','retention.planner_draft_purged','content_post',r.id::text,
      'retention_expired','planner draft exceeded inactivity retention window','purged',
      'planner_draft_inactivity:v1',null,v_correlation,null,
      jsonb_build_object('retention_expires_at',r.draft_retention_expires_at),
      '{}'::jsonb,null
    );

    delete from public.content_posts
    where id=r.id and user_id=r.user_id and status='draft';
    if found then v_purged := v_purged + 1; end if;
  end loop;

  return query select v_purged,v_held;
end;
$$;
revoke all on function public.phase8c_purge_expired_planner_drafts(integer) from public,anon,authenticated;
grant execute on function public.phase8c_purge_expired_planner_drafts(integer) to service_role;

-- Centralize the already-locked 30-day private media Trash duration.
create or replace function public.trash_private_generation_asset(
  p_asset_id uuid,
  p_owner_id uuid
) returns table(
  asset_id uuid,
  lifecycle_state text,
  trashed_at timestamptz,
  purge_after timestamptz
)
language plpgsql
security invoker
set search_path=pg_catalog,public,pg_temp
as $$
declare
  a public.generation_assets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_duration interval;
begin
  if p_asset_id is null or p_owner_id is null then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;

  select retention_duration into v_duration
  from public.current_retention_policy('private_generation_asset_trash',v_now);
  if v_duration is null then raise exception 'PRIVATE_MEDIA_RETENTION_POLICY_MISSING'; end if;

  select * into a from public.generation_assets
  where id=p_asset_id and owner_id=p_owner_id for update;
  if not found then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;
  if a.lifecycle_state='trashed' then
    return query select a.id,a.lifecycle_state,a.trashed_at,a.purge_after; return;
  end if;
  if a.lifecycle_state<>'active' then raise exception 'PRIVATE_MEDIA_ASSET_STATE_CONFLICT'; end if;

  update public.generation_assets
     set lifecycle_state='trashed',trashed_at=v_now,purge_after=v_now+v_duration
   where id=a.id
   returning id,generation_assets.lifecycle_state,generation_assets.trashed_at,generation_assets.purge_after
   into a.id,a.lifecycle_state,a.trashed_at,a.purge_after;

  update public.private_storage_objects
     set retain_until=v_now+v_duration,purge_after=v_now+v_duration
   where id=a.storage_object_id;

  return query select a.id,a.lifecycle_state,a.trashed_at,a.purge_after;
end;
$$;

-- Governance holds supplement the existing storage-level hold and active-video guard.
create or replace function public.phase8c_private_media_governance_hold(
  p_asset_id uuid,p_generation_id uuid,p_owner_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.governance_target_has_active_legal_hold('private_generation_asset',p_asset_id::text,p_owner_id)
      or public.governance_target_has_active_legal_hold('generation',p_generation_id::text,p_owner_id)
$$;
revoke all on function public.phase8c_private_media_governance_hold(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8c_claim_due_private_media_purges(p_limit integer default 25)
returns table(asset_id uuid,owner_id uuid,generation_id uuid)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'PHASE8C_PURGE_LIMIT_INVALID'; end if;
  return query
  select a.id,a.owner_id,a.generation_id
  from public.generation_assets a
  join public.private_storage_objects o on o.id=a.storage_object_id
  where a.lifecycle_state='trashed'
    and a.purge_after<=statement_timestamp()
    and o.retention_state<>'legal_hold'
    and not public.phase8c_private_media_governance_hold(a.id,a.generation_id,a.owner_id)
  order by a.purge_after,a.id
  limit p_limit;
end;
$$;
revoke all on function public.phase8c_claim_due_private_media_purges(integer) from public,anon,authenticated;
grant execute on function public.phase8c_claim_due_private_media_purges(integer) to service_role;

-- Refuse a destructive purge claim if a governance hold became active after selection.
create or replace function public.phase8c_assert_private_media_purge_allowed()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.lifecycle_state='purge_pending'
     and old.lifecycle_state='trashed'
     and public.phase8c_private_media_governance_hold(new.id,new.generation_id,new.owner_id) then
    raise exception 'PRIVATE_MEDIA_LEGAL_HOLD';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8c_assert_private_media_purge_allowed() from public,anon,authenticated,service_role;

drop trigger if exists phase8c_private_media_purge_hold_guard on public.generation_assets;
create trigger phase8c_private_media_purge_hold_guard
before update of lifecycle_state on public.generation_assets
for each row execute function public.phase8c_assert_private_media_purge_allowed();

commit;
