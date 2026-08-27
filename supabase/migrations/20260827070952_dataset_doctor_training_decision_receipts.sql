-- Phase 2A-2: DB-authoritative quality prompts, immutable decision receipts, and receipt-bound Trainer submission.
begin;
create table public.dataset_doctor_training_decision_prompts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), lora_id uuid not null references public.user_loras(id), dataset_doctor_job_id uuid not null references public.dataset_doctor_jobs(id),
 decision_contract_version text not null check(decision_contract_version='dataset-doctor-training-decision-v1'), decision_idempotency_key text not null check(length(decision_idempotency_key) between 1 and 128),
 warning_snapshot jsonb not null check(jsonb_typeof(warning_snapshot)='object'), warning_fingerprint text not null check(warning_fingerprint~'^[0-9a-f]{64}$'), dataset_snapshot jsonb not null check(jsonb_typeof(dataset_snapshot)='object'), dataset_snapshot_fingerprint text not null check(dataset_snapshot_fingerprint~'^[0-9a-f]{64}$'),
 selected_image_ids jsonb not null check(jsonb_typeof(selected_image_ids)='array'), selected_image_count integer not null check(selected_image_count>=3 and selected_image_count=jsonb_array_length(selected_image_ids)), shown_at timestamptz not null default statement_timestamp(), created_at timestamptz not null default statement_timestamp(), unique(user_id,decision_idempotency_key), check(shown_at=created_at)
);
create table public.dataset_doctor_training_decision_receipts (
 id uuid primary key default gen_random_uuid(), prompt_id uuid not null unique references public.dataset_doctor_training_decision_prompts(id), user_id uuid not null references auth.users(id), lora_id uuid not null references public.user_loras(id), dataset_doctor_job_id uuid not null references public.dataset_doctor_jobs(id),
 decision_contract_version text not null check(decision_contract_version='dataset-doctor-training-decision-v1'), decision_idempotency_key text not null check(length(decision_idempotency_key) between 1 and 128), decision text not null check(decision='train_anyway'),
 warning_snapshot jsonb not null check(jsonb_typeof(warning_snapshot)='object'), warning_fingerprint text not null check(warning_fingerprint~'^[0-9a-f]{64}$'), dataset_snapshot jsonb not null check(jsonb_typeof(dataset_snapshot)='object'), dataset_snapshot_fingerprint text not null check(dataset_snapshot_fingerprint~'^[0-9a-f]{64}$'), selected_image_ids jsonb not null check(jsonb_typeof(selected_image_ids)='array'), selected_image_count integer not null check(selected_image_count>=3 and selected_image_count=jsonb_array_length(selected_image_ids)),
 shown_at timestamptz not null, decided_at timestamptz not null default statement_timestamp(), training_job_id uuid unique references public.compute_jobs(id), created_at timestamptz not null default statement_timestamp(), unique(user_id,decision_idempotency_key), check(shown_at<=decided_at and decided_at=created_at)
);
alter table public.dataset_doctor_training_decision_prompts enable row level security;
alter table public.dataset_doctor_training_decision_receipts enable row level security;
revoke all on public.dataset_doctor_training_decision_prompts,public.dataset_doctor_training_decision_receipts from public,anon,authenticated,service_role;

create function public.dataset_training_decision_reject_changes() returns trigger language plpgsql set search_path='' as $$begin raise exception 'DATASET_TRAINING_DECISION_EVIDENCE_IMMUTABLE';end$$;
create trigger dataset_training_decision_prompts_immutable before update or delete on public.dataset_doctor_training_decision_prompts for each row execute function public.dataset_training_decision_reject_changes();
create function public.dataset_training_decision_receipt_changes() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' and old.training_job_id is null and new.training_job_id is not null and to_jsonb(new)-'training_job_id' is not distinct from to_jsonb(old)-'training_job_id' then return new; end if;
 raise exception 'DATASET_TRAINING_DECISION_EVIDENCE_IMMUTABLE';end$$;
create trigger dataset_training_decision_receipts_immutable before update or delete on public.dataset_doctor_training_decision_receipts for each row execute function public.dataset_training_decision_receipt_changes();

create function public.dataset_training_warning_snapshot(p_job public.dataset_doctor_jobs) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'balance_score',p_job.summary->'balance_score','composition_balance',p_job.summary->'composition_balance','composition_summary',p_job.summary->'composition_summary','confidence_message',p_job.summary->'confidence_message','confidence_signal',p_job.summary->'confidence_signal','dataset_grade',p_job.summary->'dataset_grade','dataset_quality_score',p_job.summary->'dataset_quality_score',
 'dataset_warnings',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(coalesce(p_job.summary->'dataset_warnings','[]'::jsonb)) x),'[]'::jsonb),
 'dataset_warnings_structured',coalesce((select jsonb_agg(x order by x::text) from jsonb_array_elements(coalesce(p_job.summary->'dataset_warnings_structured','[]'::jsonb)) x),'[]'::jsonb),
 'missing_coverage',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(coalesce(to_jsonb(p_job.missing_coverage),'[]'::jsonb)) x),'[]'::jsonb),
 'needs_more_images',to_jsonb(p_job.needs_more_images),'primary_issue',p_job.summary->'primary_issue',
 'priority_guidance',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(coalesce(p_job.summary->'priority_guidance','[]'::jsonb)) x),'[]'::jsonb),
 'secondary_issues',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements_text(coalesce(p_job.summary->'secondary_issues','[]'::jsonb)) x),'[]'::jsonb),
 'training_prediction',p_job.summary->'training_prediction')
$$;
create function public.dataset_training_fingerprint(p_value jsonb) returns text language sql immutable set search_path='' as $$select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')$$;
create function public.dataset_training_final_selection(p_job_id uuid) returns jsonb language sql stable set search_path='' as $$select coalesce(jsonb_agg(s.image_id::text order by s.image_id::text),'[]'::jsonb) from public.dataset_doctor_selections s where s.job_id=p_job_id and s.selection_type='final'$$;
create function public.dataset_training_quality_state(p_summary jsonb,p_selected_count integer,p_needs_more_images boolean,p_missing_coverage jsonb) returns text language plpgsql immutable set search_path='' as $$declare v text;item jsonb;has_reason boolean;begin
 if jsonb_typeof(p_summary)<>'object' or jsonb_typeof(p_summary->'dataset_ready')<>'boolean' then return 'prohibited';end if;
 if exists(select 1 from jsonb_object_keys(p_summary) k where k not in ('raw_count','accepted_count','rejected_count','review_count','needs_more_images','missing_coverage','composition_summary','composition_balance','balance_score','dataset_quality_score','dataset_warnings','dataset_warnings_structured','primary_issue','secondary_issues','priority_guidance','dataset_strengths','shot_suggestions','dataset_grade','training_prediction','confidence_signal','guidance','dataset_ready','confidence_message','analysis_version','mode','rebuild_from_r2','non_overridable_conditions')) then return 'prohibited';end if;
 if p_summary?'non_overridable_conditions' and (jsonb_typeof(p_summary->'non_overridable_conditions')<>'array' or jsonb_array_length(p_summary->'non_overridable_conditions')>0) then return 'prohibited';end if;
 if jsonb_typeof(coalesce(p_summary->'dataset_warnings','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_summary->'secondary_issues','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_summary->'dataset_warnings_structured','[]'::jsonb))<>'array' then return 'prohibited';end if;
 for v in select jsonb_array_elements_text(coalesce(p_summary->'dataset_warnings','[]'::jsonb)) loop if v not in ('insufficient_closeups','insufficient_midshots','insufficient_fullbody','closeup_overrepresented','fullbody_overrepresented','midshot_overrepresented','dataset_unbalanced','too_many_side_profiles','low_resolution_images_present','face_detection_uncertain_present','small_dataset_recommended_more_images') then return 'prohibited';end if;end loop;
 if p_summary->>'primary_issue' is not null and p_summary->>'primary_issue'<>'' and p_summary->>'primary_issue' not in ('too_few_accepted_images','weak_identity_signal','missing_closeups','missing_midshots','missing_fullbody','closeup_overrepresented','low_average_quality','face_detection_uncertain_present','low_resolution_images_present','too_many_side_profiles') then return 'prohibited';end if;
 for v in select jsonb_array_elements_text(coalesce(p_summary->'secondary_issues','[]'::jsonb)) loop if v not in ('too_few_accepted_images','weak_identity_signal','missing_closeups','missing_midshots','missing_fullbody','closeup_overrepresented','low_average_quality','face_detection_uncertain_present','low_resolution_images_present','too_many_side_profiles') then return 'prohibited';end if;end loop;
 for item in select * from jsonb_array_elements(coalesce(p_summary->'dataset_warnings_structured','[]'::jsonb)) loop if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'type')<>'string' or item->>'type' not in ('insufficient_closeups','insufficient_midshots','insufficient_fullbody','closeup_overrepresented','fullbody_overrepresented','midshot_overrepresented','dataset_unbalanced','too_many_side_profiles','low_resolution_images_present','face_detection_uncertain_present','small_dataset_recommended_more_images','missing_midshots') then return 'prohibited';end if;end loop;
 if p_summary->'dataset_ready'='true'::jsonb then return 'ready';end if;
 if p_selected_count<3 then return 'prohibited';end if;
 has_reason:=jsonb_array_length(coalesce(p_summary->'dataset_warnings','[]'::jsonb))>0 or jsonb_array_length(coalesce(p_summary->'secondary_issues','[]'::jsonb))>0 or coalesce(p_summary->>'primary_issue','')<>'' or jsonb_array_length(coalesce(p_summary->'dataset_warnings_structured','[]'::jsonb))>0 or coalesce(p_needs_more_images,false) or jsonb_array_length(coalesce(p_missing_coverage,'[]'::jsonb))>0;
 return case when has_reason then 'overridable' else 'prohibited' end;exception when others then return 'prohibited';end$$;
create function public.prepare_dataset_training_decision_prompt(p_user_id uuid,p_lora_id uuid,p_dataset_doctor_job_id uuid,p_decision_idempotency_key text,p_selected_image_ids uuid[])
returns table(prompt_id uuid,decision_contract_version text,shown_at timestamptz,warning_snapshot jsonb) language plpgsql security definer set search_path='' as $$declare j public.dataset_doctor_jobs; quality_state text; ids jsonb; warnings jsonb; dataset_fp text; warning_fp text; existing public.dataset_doctor_training_decision_prompts; made public.dataset_doctor_training_decision_prompts;begin
 if p_user_id is null or p_lora_id is null or p_dataset_doctor_job_id is null or length(p_decision_idempotency_key) not between 1 and 128 or cardinality(p_selected_image_ids)<3 or cardinality(p_selected_image_ids)<>(select count(distinct x) from unnest(p_selected_image_ids)x) then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 select * into j from public.dataset_doctor_jobs d where d.id=p_dataset_doctor_job_id and d.user_id=p_user_id and d.lora_id=p_lora_id and exists(select 1 from public.user_loras l where l.id=p_lora_id and l.user_id=p_user_id) for share;
 if not found then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 if j.status not in ('ready_for_review','exported') then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 select coalesce(jsonb_agg(x::text order by x::text),'[]'::jsonb) into ids from unnest(p_selected_image_ids)x;
 quality_state:=public.dataset_training_quality_state(j.summary,jsonb_array_length(ids),j.needs_more_images,to_jsonb(j.missing_coverage));
 if quality_state='prohibited' then raise exception 'DATASET_TRAINING_PROHIBITED';end if;
 if quality_state='ready' then raise exception 'DATASET_TRAINING_DECISION_NOT_REQUIRED';end if;
 if j.status='exported' then if ids is distinct from public.dataset_training_final_selection(j.id) then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 else if exists(select 1 from unnest(p_selected_image_ids)x left join public.dataset_doctor_images i on i.id=x and i.job_id=j.id and i.lora_id=p_lora_id and i.user_id=p_user_id and i.decision='accepted' where i.id is null) then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if; end if;
 warnings:=public.dataset_training_warning_snapshot(j);dataset_fp:=public.dataset_training_fingerprint(j.summary);warning_fp:=public.dataset_training_fingerprint(warnings);
 select * into existing from public.dataset_doctor_training_decision_prompts p where p.user_id=p_user_id and p.decision_idempotency_key=p_decision_idempotency_key;
 if found then if existing.lora_id<>p_lora_id or existing.dataset_doctor_job_id<>j.id or existing.dataset_snapshot is distinct from j.summary or existing.warning_snapshot is distinct from warnings or existing.selected_image_ids is distinct from ids then raise exception 'IDEMPOTENCY_CONFLICT';end if; return query select existing.id,existing.decision_contract_version,existing.shown_at,existing.warning_snapshot;return;end if;
 insert into public.dataset_doctor_training_decision_prompts(user_id,lora_id,dataset_doctor_job_id,decision_contract_version,decision_idempotency_key,warning_snapshot,warning_fingerprint,dataset_snapshot,dataset_snapshot_fingerprint,selected_image_ids,selected_image_count) values(p_user_id,p_lora_id,j.id,'dataset-doctor-training-decision-v1',p_decision_idempotency_key,warnings,warning_fp,j.summary,dataset_fp,ids,jsonb_array_length(ids)) returning * into made;
 return query select made.id,made.decision_contract_version,made.shown_at,made.warning_snapshot;
end$$;

create function public.record_dataset_training_decision_receipt(p_user_id uuid,p_lora_id uuid,p_dataset_doctor_job_id uuid,p_decision_idempotency_key text)
returns table(receipt_id uuid,decision text,decision_contract_version text,decided_at timestamptz) language plpgsql security definer set search_path='' as $$declare p public.dataset_doctor_training_decision_prompts;j public.dataset_doctor_jobs;ids jsonb;warnings jsonb;r public.dataset_doctor_training_decision_receipts;begin
 select * into p from public.dataset_doctor_training_decision_prompts x where x.user_id=p_user_id and x.decision_idempotency_key=p_decision_idempotency_key for share;if not found or p.lora_id<>p_lora_id or p.dataset_doctor_job_id<>p_dataset_doctor_job_id then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 select * into j from public.dataset_doctor_jobs d where d.id=p_dataset_doctor_job_id and d.user_id=p_user_id and d.lora_id=p_lora_id and d.status='exported' for share;if not found then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 ids:=public.dataset_training_final_selection(j.id);
 if public.dataset_training_quality_state(j.summary,jsonb_array_length(ids),j.needs_more_images,to_jsonb(j.missing_coverage))<>'overridable' then raise exception 'DATASET_TRAINING_PROHIBITED';end if;
 warnings:=public.dataset_training_warning_snapshot(j);
 if p.dataset_snapshot is distinct from j.summary or p.warning_snapshot is distinct from warnings or p.selected_image_ids is distinct from ids or p.dataset_snapshot_fingerprint<>public.dataset_training_fingerprint(j.summary) or p.warning_fingerprint<>public.dataset_training_fingerprint(warnings) then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 select * into r from public.dataset_doctor_training_decision_receipts x where x.user_id=p_user_id and x.decision_idempotency_key=p_decision_idempotency_key;if found then return query select r.id,r.decision,r.decision_contract_version,r.decided_at;return;end if;
 insert into public.dataset_doctor_training_decision_receipts(prompt_id,user_id,lora_id,dataset_doctor_job_id,decision_contract_version,decision_idempotency_key,decision,warning_snapshot,warning_fingerprint,dataset_snapshot,dataset_snapshot_fingerprint,selected_image_ids,selected_image_count,shown_at) values(p.id,p.user_id,p.lora_id,p.dataset_doctor_job_id,p.decision_contract_version,p.decision_idempotency_key,'train_anyway',p.warning_snapshot,p.warning_fingerprint,p.dataset_snapshot,p.dataset_snapshot_fingerprint,p.selected_image_ids,p.selected_image_count,p.shown_at) returning * into r;
 return query select r.id,r.decision,r.decision_contract_version,r.decided_at;
end$$;

create function public.validate_dataset_training_decision_receipt(p_receipt_id uuid,p_user_id uuid,p_lora_id uuid,p_dataset_doctor_job_id uuid)
returns table(receipt_id uuid,decision text,contract_version text,warning_fingerprint text,dataset_snapshot_fingerprint text) language plpgsql security definer set search_path='' as $$declare r public.dataset_doctor_training_decision_receipts;j public.dataset_doctor_jobs;ids jsonb;warnings jsonb;begin
 select * into r from public.dataset_doctor_training_decision_receipts x where x.id=p_receipt_id;if not found then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 if r.user_id<>p_user_id or r.lora_id<>p_lora_id or r.dataset_doctor_job_id<>p_dataset_doctor_job_id or r.decision<>'train_anyway' or r.decision_contract_version<>'dataset-doctor-training-decision-v1' then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 select * into j from public.dataset_doctor_jobs d where d.id=p_dataset_doctor_job_id and d.user_id=p_user_id and d.lora_id=p_lora_id and d.status='exported';if not found then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 ids:=public.dataset_training_final_selection(j.id);
 if public.dataset_training_quality_state(j.summary,jsonb_array_length(ids),j.needs_more_images,to_jsonb(j.missing_coverage))<>'overridable' then raise exception 'DATASET_TRAINING_PROHIBITED';end if;
 warnings:=public.dataset_training_warning_snapshot(j);
 if r.dataset_snapshot is distinct from j.summary or r.warning_snapshot is distinct from warnings or r.selected_image_ids is distinct from ids or r.selected_image_count<>jsonb_array_length(ids) or r.dataset_snapshot_fingerprint<>public.dataset_training_fingerprint(j.summary) or r.warning_fingerprint<>public.dataset_training_fingerprint(warnings) then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 return query select r.id,r.decision,r.decision_contract_version,r.warning_fingerprint,r.dataset_snapshot_fingerprint;
end$$;

create function public.link_dataset_training_decision_receipt(p_receipt_id uuid,p_training_job_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update public.dataset_doctor_training_decision_receipts r set training_job_id=p_training_job_id where r.id=p_receipt_id and r.training_job_id is null and exists(select 1 from public.compute_jobs j where j.id=p_training_job_id and j.owner_id=r.user_id and j.workload='trainer' and j.request_payload#>>'{dataset_training_decision,receipt_id}'=r.id::text);if not found then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
end$$;

create or replace function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path='' as $function$
declare
 j public.compute_jobs; current_job public.compute_jobs; policy public.compute_scheduler_policies;
 dataset_job public.dataset_doctor_jobs; requested_job_id uuid; stored_ids jsonb; decision_authority jsonb; quality_state text; receipt public.dataset_doctor_training_decision_receipts;
 expected_recipe constant jsonb := '{"version":"sf-sdxl-recommended-v1","mode":"recommended","settings":{"resolution":[1024,1024],"enable_bucket":true,"min_bucket_reso":512,"max_bucket_reso":1024,"bucket_reso_steps":64,"train_batch_size":1,"learning_rate":0.0001,"network_module":"networks.lora","network_dim":64,"network_alpha":32,"mixed_precision":"fp16","gradient_checkpointing":true,"save_model_as":"safetensors","save_every_n_steps":200,"target_effective_samples":1200,"caption_extension":".txt","caption_model":"Salesforce/blip-image-captioning-base","trigger_suffix":"woman"}}'::jsonb;
begin
 if p_owner_id is null or p_lora_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_TRAINER_SUBMISSION'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_request_payload) key) is distinct from array['dataset_doctor_job_id','dataset_reference','dataset_selection','dataset_snapshot','dataset_training_decision','identity_id','trainer_recipe']::text[]
    or jsonb_typeof(p_request_payload->'identity_id')<>'string' or p_request_payload->>'identity_id' is distinct from p_lora_id::text
    or jsonb_typeof(p_request_payload->'dataset_doctor_job_id')<>'string'
    or jsonb_typeof(p_request_payload->'dataset_reference')<>'object' or jsonb_typeof(p_request_payload->'dataset_snapshot')<>'object'
    or not(p_request_payload?'dataset_training_decision') or jsonb_typeof(p_request_payload->'dataset_selection')<>'object' or jsonb_typeof(p_request_payload->'trainer_recipe')<>'object' then raise exception 'TRAINER_REQUEST_AUTHORITY_INVALID'; end if;
 begin requested_job_id := (p_request_payload->>'dataset_doctor_job_id')::uuid; exception when invalid_text_representation then raise exception 'DATASET_JOB_ID_INVALID'; end;
 if requested_job_id::text is distinct from p_request_payload->>'dataset_doctor_job_id' then raise exception 'DATASET_JOB_ID_INVALID'; end if;
 select * into dataset_job from public.dataset_doctor_jobs d where d.id=requested_job_id and d.user_id=p_owner_id and d.lora_id=p_lora_id for share;
 if not found then raise exception 'DATASET_JOB_AUTHORITY_MISMATCH'; end if;
 if dataset_job.status is distinct from 'exported' then raise exception 'DATASET_NOT_EXPORTED'; end if;
 if dataset_job.final_r2_bucket is null or dataset_job.final_r2_prefix is null or dataset_job.final_r2_bucket is distinct from p_dataset_r2_bucket or dataset_job.final_r2_prefix is distinct from p_dataset_r2_prefix
   or dataset_job.final_r2_bucket is distinct from p_request_payload#>>'{dataset_reference,bucket}' or dataset_job.final_r2_prefix is distinct from p_request_payload#>>'{dataset_reference,prefix}' then raise exception 'DATASET_REFERENCE_MISMATCH'; end if;
 if p_request_payload->'dataset_snapshot' is distinct from dataset_job.summary then raise exception 'DATASET_SNAPSHOT_MISMATCH'; end if;
 select coalesce(jsonb_agg(s.image_id::text order by s.image_id::text),'[]'::jsonb) into stored_ids from public.dataset_doctor_selections s where s.job_id=requested_job_id and s.selection_type='final';
 if jsonb_array_length(stored_ids)=0 or p_request_payload#>'{dataset_selection,image_ids}' is distinct from stored_ids
   or jsonb_typeof(p_request_payload#>'{dataset_selection,image_count}')<>'number'
   or (p_request_payload#>>'{dataset_selection,image_count}')::integer <> jsonb_array_length(stored_ids) then raise exception 'DATASET_SELECTION_MISMATCH'; end if;
 quality_state:=public.dataset_training_quality_state(dataset_job.summary,jsonb_array_length(stored_ids),dataset_job.needs_more_images,to_jsonb(dataset_job.missing_coverage));
 if quality_state='prohibited' then raise exception 'DATASET_TRAINING_PROHIBITED';end if;
 decision_authority:=p_request_payload->'dataset_training_decision';
 if quality_state='ready' then if decision_authority is distinct from 'null'::jsonb then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
 else
  if decision_authority is null or decision_authority='null'::jsonb then raise exception 'DATASET_TRAINING_DECISION_REQUIRED';end if;
  if jsonb_typeof(decision_authority)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(decision_authority)key) is distinct from array['contract_version','dataset_snapshot_fingerprint','decision','receipt_id','warning_fingerprint']::text[] then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
  begin select * into receipt from public.dataset_doctor_training_decision_receipts r where r.id=(decision_authority->>'receipt_id')::uuid;exception when invalid_text_representation then raise exception 'DATASET_TRAINING_DECISION_INVALID';end;
  if not found or receipt.user_id<>p_owner_id or receipt.lora_id<>p_lora_id or receipt.dataset_doctor_job_id<>requested_job_id or receipt.decision<>'train_anyway' or receipt.decision_contract_version<>'dataset-doctor-training-decision-v1' or decision_authority->>'decision'<>receipt.decision or decision_authority->>'contract_version'<>receipt.decision_contract_version then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
  if receipt.dataset_snapshot is distinct from dataset_job.summary or receipt.warning_snapshot is distinct from public.dataset_training_warning_snapshot(dataset_job) or receipt.selected_image_ids is distinct from stored_ids or receipt.dataset_snapshot_fingerprint<>public.dataset_training_fingerprint(dataset_job.summary) or receipt.warning_fingerprint<>public.dataset_training_fingerprint(public.dataset_training_warning_snapshot(dataset_job)) or decision_authority->>'warning_fingerprint'<>receipt.warning_fingerprint or decision_authority->>'dataset_snapshot_fingerprint'<>receipt.dataset_snapshot_fingerprint then raise exception 'DATASET_TRAINING_DECISION_STALE';end if;
 end if;
 if p_request_payload->'trainer_recipe' is distinct from expected_recipe then raise exception 'TRAINER_RECIPE_INVALID'; end if;
 perform 1 from public.user_loras where id=p_lora_id and user_id=p_owner_id for update; if not found then raise exception 'TRAINER_TARGET_NOT_OWNED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':trainer:'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload='trainer' and x.idempotency_key=p_idempotency_key;
 if found then
  if j.request_fingerprint<>p_request_fingerprint or j.request_payload is distinct from p_request_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 else
  if receipt.id is not null and receipt.training_job_id is not null then raise exception 'DATASET_TRAINING_DECISION_INVALID';end if;
  select x.* into current_job from public.user_loras l join public.compute_jobs x on x.id::text=l.training_job_id where l.id=p_lora_id and x.owner_id=p_owner_id and x.workload='trainer';
  if found and current_job.state not in ('succeeded','failed','cancelled') then raise exception 'TRAINER_ALREADY_ACTIVE'; end if;
  select * into policy from public.compute_scheduler_policies p where p.workload='trainer' and p.enabled;
  if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts) values(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
  update public.user_loras set training_job_id=j.id::text,status='queued',progress=0,started_at=null,completed_at=null,error_message=null,artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null,dataset_r2_bucket=p_dataset_r2_bucket,dataset_r2_prefix=p_dataset_r2_prefix,updated_at=pg_catalog.clock_timestamp() where id=p_lora_id and user_id=p_owner_id;
  if not found then raise exception 'TRAINER_PROJECTION_FAILED'; end if;
  if receipt.id is not null then perform public.link_dataset_training_decision_receipt(receipt.id,j.id);end if;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end $function$;
revoke execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) from public,anon,authenticated;grant execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) to service_role;
revoke execute on function public.dataset_training_decision_reject_changes(),public.dataset_training_decision_receipt_changes(),public.dataset_training_warning_snapshot(public.dataset_doctor_jobs),public.dataset_training_fingerprint(jsonb),public.dataset_training_final_selection(uuid),public.dataset_training_quality_state(jsonb,integer,boolean,jsonb),public.link_dataset_training_decision_receipt(uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.prepare_dataset_training_decision_prompt(uuid,uuid,uuid,text,uuid[]) from public,anon,authenticated;grant execute on function public.prepare_dataset_training_decision_prompt(uuid,uuid,uuid,text,uuid[]) to service_role;
revoke execute on function public.record_dataset_training_decision_receipt(uuid,uuid,uuid,text) from public,anon,authenticated;grant execute on function public.record_dataset_training_decision_receipt(uuid,uuid,uuid,text) to service_role;
revoke execute on function public.validate_dataset_training_decision_receipt(uuid,uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.validate_dataset_training_decision_receipt(uuid,uuid,uuid,uuid) to service_role;
commit;
