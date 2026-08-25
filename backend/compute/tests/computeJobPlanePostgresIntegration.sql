\set ON_ERROR_STOP on
insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.compute_scheduler_policies(workload,max_global_active,lease_seconds,stale_seconds,max_attempts,og_priority_seconds,enabled) values ('image',1,15,30,2,60,true),('trainer',1,15,30,2,60,true),('video',1,15,30,2,60,true),('stitch',1,15,30,2,0,true);
do $$ declare a uuid; b uuid; begin
 select job_id into a from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('a',64),'{}','standard');
 select job_id into b from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('a',64),'{}','standard'); assert a=b;
 begin perform * from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('b',64),'{}','standard'); raise exception 'expected conflict'; exception when others then assert sqlerrm like '%IDEMPOTENCY_CONFLICT%'; end;
end$$;
do $$ declare j uuid; a uuid; l uuid; begin
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','test-worker'); assert j is not null;
 assert not exists(select 1 from public.claim_compute_job('image','other-worker'));
 begin perform public.compute_worker_transition(j,a,gen_random_uuid(),'start'); raise exception 'expected lease rejection'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
 assert public.compute_worker_transition(j,a,l,'start')='running';
 perform public.mark_compute_provider_dispatch(j,a,l,'opaque-op'); update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' and lease_token is null from public.compute_jobs where id=j); assert (select provider_operation_ref='opaque-op' from public.compute_job_attempts where id=a);
end$$;
do $$ declare j uuid; begin select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','trainer','cancel',repeat('c',64),'{}','standard'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000002',j); assert (select state='cancelled' from public.compute_jobs where id=j); begin perform public.cancel_compute_job('10000000-0000-4000-8000-000000000001',j); raise exception 'wrong owner accepted'; exception when others then assert sqlerrm like '%COMPUTE_JOB_NOT_FOUND%'; end; end$$;
set role anon; do $$ begin begin perform * from public.compute_jobs; raise exception 'anon read accepted'; exception when insufficient_privilege then null; end; begin perform public.claim_compute_job('image','bad'); raise exception 'anon rpc accepted'; exception when insufficient_privilege then null; end; end$$; reset role;
insert into public.compute_spend_policies(version,effective_from,daily_limit_micros,monthly_limit_micros,video_job_limit_micros,enabled) values(1,now(),1000,2000,500,true);
do $$ declare j uuid; a uuid; l uuid; begin select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','video','cost',repeat('d',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','cost-worker'); assert not public.authorize_compute_dispatch(j,a,l,501); assert public.authorize_compute_dispatch(j,a,l,500); perform public.compute_worker_transition(j,a,l,'start'); perform public.record_compute_actual_cost(j,a,1100,100,'{}'); perform public.compute_worker_transition(j,a,l,'success',null,'{}'); assert (select state='succeeded' from public.compute_jobs where id=j); end$$;
select 'compute job plane postgres integration passed';
