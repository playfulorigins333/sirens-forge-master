\set ON_ERROR_STOP on

-- RPCs are privileged service boundaries only.
do $$declare f text;begin foreach f in array array['trash_user_lora(uuid,uuid)','restore_user_lora(uuid,uuid)','claim_user_lora_training_data_purge(uuid,uuid,uuid)','finalize_user_lora_training_data_purge(uuid,uuid,uuid)','reactivate_user_lora_training_data(uuid,uuid)','claim_user_lora_purge(uuid,uuid,uuid,text,boolean)','finalize_user_lora_purge(uuid,uuid,uuid)'] loop
 if has_function_privilege('authenticated',f,'execute') then raise exception 'authenticated unexpectedly executes %',f; end if;
 if has_function_privilege('anon',f,'execute') then raise exception 'anon unexpectedly executes %',f; end if;
 if not has_function_privilege('service_role',f,'execute') then raise exception 'service_role missing execute %',f; end if;
 end loop;end$$;

-- Trash is 30-day recoverable and immediately blocks new use.
select * from public.trash_user_lora('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
do $$declare l public.user_loras;begin select * into l from public.user_loras where id='20000000-0000-4000-8000-000000000001'; if l.lifecycle_state<>'trashed' or l.trashed_at is null or l.purge_after < l.trashed_at+interval '29 days 23 hours' or l.purge_after > l.trashed_at+interval '30 days 1 hour' then raise exception 'trash contract failed';end if;end$$;
do $$begin begin insert into public.dataset_doctor_jobs(id,lora_id,user_id,status) values('30000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','uploaded'); raise exception 'expected twin gate'; exception when others then if sqlerrm not like '%TWIN_NOT_ACTIVE%' then raise; end if; end;end$$;
do $$begin begin insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload) values('10000000-0000-4000-8000-000000000001','image','blocked-image',repeat('a',64),jsonb_build_object('identity_id','20000000-0000-4000-8000-000000000001')); raise exception 'expected compute twin gate'; exception when others then if sqlerrm not like '%TWIN_NOT_ACTIVE%' then raise; end if; end;end$$;

-- Restore re-enables new use and clears recovery timestamps.
select * from public.restore_user_lora('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
do $$declare l public.user_loras;begin select * into l from public.user_loras where id='20000000-0000-4000-8000-000000000001';if l.lifecycle_state<>'active' or l.trashed_at is not null or l.purge_after is not null then raise exception 'restore contract failed';end if;end$$;

-- Training data can be deleted independently without deleting the Twin artifact.
select * from public.claim_user_lora_training_data_purge('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001');
select * from public.finalize_user_lora_training_data_purge('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001');
do $$declare l public.user_loras;begin select * into l from public.user_loras where id='20000000-0000-4000-8000-000000000001';if l.lifecycle_state<>'active' or l.training_data_state<>'purged' or l.artifact_r2_key is null or l.trigger_token is null or l.dataset_r2_bucket is not null or l.dataset_doctor_job_id is not null then raise exception 'training data separation failed';end if;if exists(select 1 from public.dataset_doctor_images where lora_id=l.id) or exists(select 1 from public.dataset_doctor_selections where lora_id=l.id) then raise exception 'training content rows remain';end if;end$$;

-- A creator may start a fresh training dataset later, without recreating the Twin.
select * from public.reactivate_user_lora_training_data('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
do $$begin if (select training_data_state from public.user_loras where id='20000000-0000-4000-8000-000000000001')<>'active' then raise exception 'training data reactivation failed';end if;end$$;

-- Active Trainer compute prevents physical data/Twin purge.
insert into public.compute_jobs(id,owner_id,workload,state,idempotency_key,request_fingerprint,request_payload) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','trainer','running','active-trainer',repeat('b',64),jsonb_build_object('identity_id','20000000-0000-4000-8000-000000000001'));
do $$begin begin perform public.claim_user_lora_training_data_purge('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002');raise exception 'expected active trainer block';exception when others then if sqlerrm not like '%TWIN_PURGE_BLOCKED_ACTIVE_TRAINER%' then raise;end if;end;end$$;
update public.compute_jobs set state='failed',terminal_at=now() where id='70000000-0000-4000-8000-000000000001';

-- Fresh upload authority blocks physical purge until its signed-URL window has expired.
insert into public.dataset_doctor_jobs(id,lora_id,user_id,status,created_at,updated_at) values('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','uploaded',now(),now());
do $$begin begin perform public.claim_user_lora_training_data_purge('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003');raise exception 'expected upload window block';exception when others then if sqlerrm not like '%TWIN_PURGE_BLOCKED_UPLOAD_WINDOW%' then raise;end if;end;end$$;
update public.dataset_doctor_jobs set created_at=now()-interval '20 minutes',updated_at=now()-interval '20 minutes' where id='30000000-0000-4000-8000-000000000002';

-- Permanent Twin purge requires Trash, keeps the row for FKs/lineage, and tombstones artifact/training authority.
select * from public.trash_user_lora('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
select * from public.claim_user_lora_purge('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','creator_permanent_delete',true);
select * from public.finalize_user_lora_purge('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004');
do $$declare l public.user_loras;begin select * into l from public.user_loras where id='20000000-0000-4000-8000-000000000002';if not found then raise exception 'Twin tombstone row was deleted';end if;if l.lifecycle_state<>'purged' or l.training_data_state<>'purged' or l.artifact_r2_bucket is not null or l.artifact_r2_key is not null or l.trigger_token is not null or l.purged_at is null then raise exception 'Twin tombstone contract failed';end if;end$$;

-- Foreign-owner operations fail without disclosure.
do $$begin begin perform public.trash_user_lora('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001');raise exception 'expected owner rejection';exception when others then if sqlerrm not like '%TWIN_NOT_FOUND%' then raise;end if;end;end$$;
