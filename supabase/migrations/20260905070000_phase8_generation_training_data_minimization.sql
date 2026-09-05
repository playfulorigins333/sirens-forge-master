-- Phase 8B: generation/training data minimization.
-- Minimize transient compute request payloads after terminal execution and remove
-- duplicate private generation metadata while preserving canonical creator-facing
-- records, durable fingerprints, result references, and legal-hold evidence.
--
-- This migration does NOT purge creator media, Twin training datasets, audit
-- evidence, action receipts, or Auth rows. Phase 7 lifecycle deadlines are unchanged.

begin;

create or replace function public.phase8_minimized_compute_request(
  p_workload public.compute_workload,
  p_payload jsonb
) returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v jsonb := case when jsonb_typeof(p_payload)='object' then p_payload else '{}'::jsonb end;
  v_decision jsonb := case when jsonb_typeof(v->'dataset_training_decision')='object' then v->'dataset_training_decision' else null end;
  v_recipe jsonb := case when jsonb_typeof(v->'trainer_recipe')='object' then v->'trainer_recipe' else null end;
begin
  if p_workload='trainer' then
    return jsonb_strip_nulls(jsonb_build_object(
      'minimization_version',1,
      'identity_id',v->'identity_id',
      'dataset_doctor_job_id',v->'dataset_doctor_job_id',
      'dataset_training_decision',case when v_decision is null then null else jsonb_strip_nulls(jsonb_build_object(
        'receipt_id',v_decision->'receipt_id',
        'decision',v_decision->'decision',
        'contract_version',v_decision->'contract_version',
        'warning_fingerprint',v_decision->'warning_fingerprint',
        'dataset_snapshot_fingerprint',v_decision->'dataset_snapshot_fingerprint'
      )) end,
      'trainer_recipe',case when v_recipe is null then null else jsonb_strip_nulls(jsonb_build_object(
        'version',v_recipe->'version',
        'mode',v_recipe->'mode'
      )) end
    ));
  elsif p_workload='image' then
    return jsonb_strip_nulls(jsonb_build_object(
      'minimization_version',1,
      'identity_id',v->'identity_id',
      'body_presentation',v->'body_presentation',
      'width',v->'width',
      'height',v->'height',
      'steps',v->'steps',
      'cfg',v->'cfg',
      'seed',v->'seed',
      'batch',v->'batch'
    ));
  elsif p_workload='video' then
    return jsonb_strip_nulls(jsonb_build_object(
      'minimization_version',1,
      'project_id',v->'project_id',
      'mode',v->'mode',
      'identity_id',v->'identity_id',
      'source_generation_asset_id',v->'source_generation_asset_id',
      'body_type',v->'body_type',
      'width',v->'width',
      'height',v->'height',
      'duration_seconds',v->'duration_seconds',
      'fps',v->'fps',
      'seed',v->'seed'
    ));
  elsif p_workload='stitch' then
    return jsonb_strip_nulls(jsonb_build_object(
      'minimization_version',1,
      'project_id',v->'project_id'
    ));
  end if;
  return jsonb_build_object('minimization_version',1);
end;
$$;
revoke all on function public.phase8_minimized_compute_request(public.compute_workload,jsonb) from public, anon, authenticated, service_role;

create or replace function public.phase8_minimize_terminal_compute_payload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_minimized jsonb;
begin
  if new.state not in ('succeeded','failed','cancelled') or old.state=new.state then return new; end if;
  if public.governance_target_has_active_legal_hold('compute_job',new.id::text,new.owner_id) then return new; end if;
  v_minimized := public.phase8_minimized_compute_request(new.workload,new.request_payload);
  if new.request_payload is distinct from v_minimized then
    update public.compute_jobs
       set request_payload=v_minimized,
           updated_at=clock_timestamp()
     where id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.phase8_minimize_terminal_compute_payload() from public, anon, authenticated, service_role;

drop trigger if exists zz_phase8_minimize_terminal_compute_payload on public.compute_jobs;
create trigger zz_phase8_minimize_terminal_compute_payload
after update of state on public.compute_jobs
for each row execute function public.phase8_minimize_terminal_compute_payload();

create or replace function public.phase8_guard_terminal_compute_payload_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.state in ('succeeded','failed','cancelled')
     and old.state in ('succeeded','failed','cancelled')
     and not public.governance_target_has_active_legal_hold('compute_job',new.id::text,new.owner_id) then
    new.request_payload := public.phase8_minimized_compute_request(new.workload,new.request_payload);
  end if;
  return new;
end;
$$;
revoke all on function public.phase8_guard_terminal_compute_payload_update() from public, anon, authenticated, service_role;

drop trigger if exists phase8_guard_terminal_compute_payload_update on public.compute_jobs;
create trigger phase8_guard_terminal_compute_payload_update
before update of request_payload on public.compute_jobs
for each row execute function public.phase8_guard_terminal_compute_payload_update();

create or replace function public.phase8_minimized_generation_metadata(p_metadata jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_metadata)<>'object' then '{}'::jsonb
    else p_metadata - array[
      'prompt','raw_prompt','negative_prompt','caption','caption_body','content','content_body',
      'identity_lora','request','workflow_json','image_base64','file_bytes','binary'
    ]::text[]
  end
$$;
revoke all on function public.phase8_minimized_generation_metadata(jsonb) from public, anon, authenticated, service_role;

create or replace function public.phase8_minimize_generation_metadata_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op='UPDATE'
     and public.governance_target_has_active_legal_hold('generation',new.id::text,new.user_id) then
    return new;
  end if;
  new.metadata := public.phase8_minimized_generation_metadata(new.metadata);
  return new;
end;
$$;
revoke all on function public.phase8_minimize_generation_metadata_write() from public, anon, authenticated, service_role;

drop trigger if exists phase8_minimize_generation_metadata_write on public.generations;
create trigger phase8_minimize_generation_metadata_write
before insert or update of metadata on public.generations
for each row execute function public.phase8_minimize_generation_metadata_write();

-- Backfill only duplicated/transient copies. Canonical generations.prompt,
-- generations.negative_prompt and creator media remain intact. Active legal holds win.
update public.compute_jobs j
   set request_payload=public.phase8_minimized_compute_request(j.workload,j.request_payload),
       updated_at=clock_timestamp()
 where j.state in ('succeeded','failed','cancelled')
   and not public.governance_target_has_active_legal_hold('compute_job',j.id::text,j.owner_id)
   and j.request_payload is distinct from public.phase8_minimized_compute_request(j.workload,j.request_payload);

update public.generations g
   set metadata=public.phase8_minimized_generation_metadata(g.metadata),
       updated_at=clock_timestamp()
 where not public.governance_target_has_active_legal_hold('generation',g.id::text,g.user_id)
   and g.metadata is distinct from public.phase8_minimized_generation_metadata(g.metadata);

commit;
