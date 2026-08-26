\set ON_ERROR_STOP on

-- Pass 4A privileged RPC ACLs and generic-success guards.
do $$ begin
 assert not has_function_privilege('public','public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb)','execute');
 assert not has_function_privilege('anon','public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text)','execute');
 assert has_function_privilege('service_role','public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb)','execute');
 assert has_function_privilege('service_role','public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text)','execute');
end$$;

-- Normal Image finalization commits canonical product and terminal compute state together.
do $$ declare j uuid; a uuid; l uuid; g uuid:='30000000-0000-4000-8000-000000000001'; product jsonb;
 assets jsonb:='[{"owner_id":"10000000-0000-4000-8000-000000000001","ordinal":0,"kind":"image","storage_class":"creator_generation","bucket":"private-test","object_key":"normal.png","mime_type":"image/png","size_bytes":8,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','p4-image',repeat('1',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','p4-image-worker'); perform public.compute_worker_transition(j,a,l,'start');
 perform public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'image-op'); perform public.record_compute_actual_cost(j,a,l,0,4);
 begin perform public.compute_worker_transition(j,a,l,'success'); raise exception 'generic Image success bypassed'; exception when others then assert sqlerrm like '%WORKLOAD_FINALIZATION_REQUIRED%'; end;
 product:=public.finalize_image_compute_job(j,a,l,g,'{"prompt":"safe","steps":20,"cfg_scale":7,"seed":1,"width":512,"height":512,"processing_time_ms":4}',assets);
 assert product->>'generation_id'=g::text and jsonb_array_length(product->'asset_ids')=1;
 assert (select state='succeeded' and result_reference=product from public.compute_jobs where id=j);
 assert (select outcome_class='succeeded' and finished_at is not null from public.compute_job_attempts where id=a);
 assert (select count(*)=1 from public.generations where id=g and status='completed'); assert (select count(*)=1 from public.generation_assets where generation_id=g);
 assert public.finalize_image_compute_job(j,a,l,g,'{"prompt":"safe","steps":20,"cfg_scale":7,"seed":1,"width":512,"height":512,"processing_time_ms":4}',assets)=product;
 begin perform public.finalize_image_compute_job(j,a,l,g,'{"prompt":"safe","steps":20,"cfg_scale":7,"seed":1,"width":512,"height":512,"processing_time_ms":4}',jsonb_set(assets,'{0,object_key}','"other.png"')); raise exception 'Image conflict replay accepted'; exception when others then assert sqlerrm in ('IMAGE_FINALIZATION_REPLAY_CONFLICT','PRIVATE_GENERATION_ASSET_CONFLICT','PRIVATE_GENERATION_ASSET_SET_CONFLICT'); end;
end$$;

-- Trainer projection and normal atomic artifact completion.
do $$ declare j uuid; a uuid; l uuid; begin
 select job_id into j from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','p4-trainer',repeat('2',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','standard','datasets','approved/a');
 assert (select status='queued' and training_job_id=j::text from public.user_loras where id='20000000-0000-4000-8000-000000000001');
 begin perform * from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','p4-trainer-second',repeat('3',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','standard','datasets','approved/a'); raise exception 'same Twin active job replaced'; exception when others then assert sqlerrm like '%TRAINER_ALREADY_ACTIVE%'; end;
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('trainer','p4-trainer-worker'); assert (select status='training' from public.user_loras where id='20000000-0000-4000-8000-000000000001');
 perform public.compute_worker_transition(j,a,l,'start'); perform public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'trainer-op'); perform public.record_compute_actual_cost(j,a,l,0,5);
 begin perform public.compute_worker_transition(j,a,l,'success'); raise exception 'generic Trainer success bypassed'; exception when others then assert sqlerrm like '%WORKLOAD_FINALIZATION_REQUIRED%'; end;
 assert public.finalize_trainer_compute_job(j,a,l,'identity-loras','10000000/artifact.safetensors')='succeeded';
 assert (select status='completed' and progress=100 and artifact_r2_bucket='identity-loras' and artifact_r2_key='10000000/artifact.safetensors' and trigger_token='sf20000000' and completed_at is not null from public.user_loras where id='20000000-0000-4000-8000-000000000001');
 assert public.finalize_trainer_compute_job(j,a,l,'identity-loras','10000000/artifact.safetensors')='succeeded';
 begin perform public.finalize_trainer_compute_job(j,a,l,'identity-loras','different.safetensors'); raise exception 'Trainer conflict replay accepted'; exception when others then assert sqlerrm like '%TRAINER_FINALIZATION_REPLAY_CONFLICT%'; end;
end$$;

-- Recovery authority settles cost and commits the canonical Image product atomically.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; g uuid:='30000000-0000-4000-8000-000000000002'; product jsonb;
 assets jsonb:='[{"owner_id":"10000000-0000-4000-8000-000000000002","ordinal":0,"kind":"image","storage_class":"creator_generation","bucket":"private-test","object_key":"recovered.png","mime_type":"image/png","size_bytes":8,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','image','p4-image-recovery',repeat('7',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','p4-image-recovery-worker'); perform public.compute_worker_transition(j,a,l,'start'); perform public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'recovered-image-op');
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('image','p4-image-reconciler') where job_id=j;
 begin perform public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,null,0,7,'recovered-image-op'); raise exception 'generic recovered Image bypassed'; exception when others then assert sqlerrm like '%WORKLOAD_FINALIZATION_REQUIRED%'; end;
 product:=public.finalize_recovered_image_compute_job(j,a,rt,rl,g,'{"prompt":"safe","steps":20,"cfg_scale":7,"seed":2,"width":512,"height":512,"processing_time_ms":7}',assets,0,7,'recovered-image-op');
 assert (select state='succeeded' and result_reference=product from public.compute_jobs where id=j); assert (select actual_cost_micros=0 and recovery_fingerprint is not null from public.compute_job_attempts where id=a);
 assert public.finalize_recovered_image_compute_job(j,a,rt,rl,g,'{"prompt":"safe","steps":20,"cfg_scale":7,"seed":2,"width":512,"height":512,"processing_time_ms":7}',assets,0,7,'recovered-image-op')=product;
end$$;

-- Recovery Trainer success owns artifact completion; generic reconciliation cannot bypass it.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; begin
 select job_id into j from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','p4-trainer-recovery',repeat('8',64),'{"identity_id":"20000000-0000-4000-8000-000000000002"}','standard','datasets','approved/b');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('trainer','p4-trainer-recovery-worker'); perform public.compute_worker_transition(j,a,l,'start'); perform public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'recovered-trainer-op');
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select status='training' from public.user_loras where id='20000000-0000-4000-8000-000000000002'); select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('trainer','p4-trainer-reconciler') where job_id=j;
 begin perform public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,null,0,8,'recovered-trainer-op'); raise exception 'generic recovered Trainer bypassed'; exception when others then assert sqlerrm like '%WORKLOAD_FINALIZATION_REQUIRED%'; end;
 assert public.finalize_recovered_trainer_compute_job(j,a,rt,rl,'identity-loras','20000000/recovered.safetensors',0,8,'recovered-trainer-op')='succeeded';
 assert (select status='completed' and progress=100 and trigger_token='sf20000000' and artifact_r2_key='20000000/recovered.safetensors' from public.user_loras where id='20000000-0000-4000-8000-000000000002');
 assert public.finalize_recovered_trainer_compute_job(j,a,rt,rl,'identity-loras','20000000/recovered.safetensors',0,8,'recovered-trainer-op')='succeeded';
end$$;

-- Stitch retains generic success; Video remains policy-disabled when explicitly disabled.
do $$ declare j uuid; a uuid; l uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','stitch','p4-stitch',repeat('4',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('stitch','p4-stitch-worker'); perform public.compute_worker_transition(j,a,l,'start'); perform public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'stitch-op'); perform public.record_compute_actual_cost(j,a,l,0,1); assert public.compute_worker_transition(j,a,l,'success')='succeeded';
 update public.compute_scheduler_policies set enabled=false where workload='video';
 begin perform * from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','p4-video',repeat('5',64),'{}','standard'); raise exception 'Video unexpectedly submitted'; exception when others then assert sqlerrm like '%COMPUTE_POLICY_UNCONFIGURED%'; end;
end$$;

-- Projection ignores succeeded and stale bindings, and maps creator-safe failures/cancellation.
do $$ declare j uuid; begin
 insert into public.compute_jobs(owner_id,workload,state,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
 values('10000000-0000-4000-8000-000000000002','trainer','queued','projection',repeat('6',64),'{"identity_id":"20000000-0000-4000-8000-000000000002"}','standard',2) returning id into j;
 update public.user_loras set training_job_id=j::text,status='queued' where id='20000000-0000-4000-8000-000000000002';
 update public.compute_jobs set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 hour' where id=j; assert (select status='training' from public.user_loras where id='20000000-0000-4000-8000-000000000002');
 update public.user_loras set training_job_id=gen_random_uuid()::text,status='draft' where id='20000000-0000-4000-8000-000000000002';
 update public.compute_jobs set state='failed',safe_error_code='TRAINING_FAILED',terminal_at=now(),lease_token=null,lease_expires_at=null where id=j; assert (select status='draft' from public.user_loras where id='20000000-0000-4000-8000-000000000002');
end$$;
