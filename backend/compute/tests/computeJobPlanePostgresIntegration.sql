\set ON_ERROR_STOP on
-- Migration blast radius and concurrent idempotency.
do $$ begin
 assert has_table_privilege('anon','public.compute_unrelated_grant_sentinel','select');
 assert has_table_privilege('authenticated','public.compute_unrelated_grant_sentinel','select');
 assert has_table_privilege('authenticated','public.compute_unrelated_grant_sentinel','insert');
 assert (select count(*)=1 from public.compute_jobs where owner_id='10000000-0000-4000-8000-000000000001' and workload='stitch' and idempotency_key='concurrent');
end$$;
-- Sequential idempotency and conflict.
do $$ declare a uuid; b uuid; begin
 select job_id into a from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('b',64),'{}','standard');
 select job_id into b from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('b',64),'{}','standard'); assert a=b;
 begin perform * from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('c',64),'{}','standard'); raise exception 'expected conflict'; exception when others then assert sqlerrm like '%IDEMPOTENCY_CONFLICT%'; end;
end$$;
-- Trainer submission and creator projection are one transaction.
do $$ declare j uuid; j2 uuid; before_count integer; begin
 select job_id into j from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trainer-atomic',repeat('e',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','og','private-datasets','approved/path');
 select job_id into j2 from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trainer-atomic',repeat('e',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','og','private-datasets','approved/path'); assert j=j2;
 assert (select training_job_id=j::text and status='queued' from public.user_loras where id='20000000-0000-4000-8000-000000000001');
 begin perform * from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trainer-atomic',repeat('f',64),'{}','og','private-datasets','approved/path'); raise exception 'trainer conflict accepted'; exception when others then assert sqlerrm like '%IDEMPOTENCY_CONFLICT%'; end;
 select count(*) into before_count from public.compute_jobs; begin perform * from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','trainer-orphan',repeat('a',64),'{}','standard','private-datasets','approved/path'); raise exception 'foreign trainer accepted'; exception when others then assert sqlerrm like '%TRAINER_TARGET_NOT_OWNED%'; end; assert (select count(*)=before_count from public.compute_jobs);
end$$;
-- Browser roles cannot inspect/mutate/execute workers; service role cannot bypass tables.
set role anon; do $$ begin begin perform * from public.compute_jobs; raise exception 'anon read accepted'; exception when insufficient_privilege then null; end; begin perform public.claim_compute_job('image','bad'); raise exception 'anon rpc accepted'; exception when insufficient_privilege then null; end; end$$; reset role;
set role authenticated; do $$ begin begin insert into public.compute_jobs default values; raise exception 'authenticated dml accepted'; exception when insufficient_privilege then null; end; end$$; reset role;
set role service_role; do $$ begin begin update public.compute_jobs set state='succeeded'; raise exception 'service bypass accepted'; exception when insufficient_privilege then null; end; end$$; reset role;
-- Heartbeat renews both leases and stale recovery waits for the renewed expiry.
do $$ declare j uuid; a uuid; l uuid; old_exp timestamptz; renewed timestamptz; begin
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','heartbeat-worker'); select lease_expires_at into old_exp from public.compute_jobs where id=j;
 perform pg_sleep(0.01); renewed:=public.heartbeat_compute_job(j,a,l); assert renewed>old_exp, 'heartbeat did not extend'; assert (select lease_expires_at=renewed from public.compute_job_attempts where id=a), 'attempt lease mismatch';
 begin perform public.heartbeat_compute_job(j,a,gen_random_uuid()); raise exception 'wrong heartbeat accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
 update public.compute_jobs set lease_expires_at=old_exp where id=j; update public.compute_job_attempts set lease_expires_at=old_exp where id=a; perform public.heartbeat_compute_job(j,a,l); perform public.recover_stale_compute_jobs(); assert (select state='claimed' from public.compute_jobs where id=j), 'old expiry recovered';
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='queued' from public.compute_jobs where id=j), 'stopped heartbeat not recovered'; update public.compute_jobs set available_at=now()+interval '1 hour' where id=j;
 begin perform public.mark_compute_provider_dispatch(j,a,l,'stale-op'); raise exception 'stale dispatch accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
end$$;
-- Bounded normal pre-dispatch retry and next ordinal.
do $$ declare j uuid; a uuid; l uuid; a2 uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','image','normal-retry',repeat('0',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','retry-1'); assert public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0)='queued'; assert (select retry_count=1 from public.compute_jobs where id=j);
 select attempt_id,lease_token into a2,l from public.claim_compute_job('image','retry-2'); assert a2<>a; assert (select ordinal=2 from public.compute_job_attempts where id=a2); assert public.retry_compute_pre_dispatch(j,a2,l,'TRANSIENT_FAILURE',0)='failed'; assert (select retry_count=2 from public.compute_jobs where id=j);
end$$;
-- Dispatch locking, post-dispatch recovery, no normal claim, and explicit reconciliation.
do $$ declare j uuid; a uuid; l uuid; rt uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','image','recover',repeat('d',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','dispatch-worker');
 perform public.compute_worker_transition(j,a,l,'start'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'opaque-op'); perform public.mark_compute_provider_dispatch(j,a,l,'opaque-op');
 begin perform public.mark_compute_provider_dispatch(j,a,l,'different-op'); raise exception 'operation replacement accepted'; exception when others then assert sqlerrm like '%PROVIDER_OPERATION_CONFLICT%'; end;
 begin perform public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0); raise exception 'post dispatch retry accepted'; exception when others then assert sqlerrm like '%POST_DISPATCH_RETRY_FORBIDDEN%'; end;
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' from public.compute_jobs where id=j); assert (select provider_operation_ref='opaque-op' from public.compute_job_attempts where id=a); assert not exists(select 1 from public.claim_compute_job('image','duplicate-worker') where job_id=j);
 select recovery_token into rt from public.compute_job_attempts where id=a; begin perform public.reconcile_compute_recovery(j,a,rt,'requeue',false); raise exception 'unsafe requeue accepted'; exception when others then assert sqlerrm like '%PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED%'; end;
 assert public.reconcile_compute_recovery(j,a,rt,'succeeded',false,null,jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001','provider','secret'))='succeeded';
 assert (select result_reference=jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001') from public.creator_compute_status('10000000-0000-4000-8000-000000000002',j));
end$$;
-- Safe requeue requires positive non-execution evidence.
do $$ declare j uuid; a uuid; l uuid; rt uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','trainer','reconcile-requeue',repeat('e',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('trainer','reconcile-worker'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'trainer-op'); update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); select recovery_token into rt from public.compute_job_attempts where id=a; assert public.reconcile_compute_recovery(j,a,rt,'requeue',true)='queued';
end$$;
-- Cancellation: queued terminal, stale pre-dispatch terminal, dispatched ambiguity reconciles.
do $$ declare j uuid; a uuid; l uuid; rt uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-queued',repeat('f',64),'{}','standard'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); assert (select state='cancelled' from public.compute_jobs where id=j); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j);
 begin perform public.cancel_compute_job('10000000-0000-4000-8000-000000000001',j); raise exception 'wrong owner accepted'; exception when others then assert sqlerrm like '%COMPUTE_JOB_NOT_FOUND%'; end;
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-stale',repeat('1',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','cancel-worker'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); begin perform public.mark_compute_provider_dispatch(j,a,l,'must-not-dispatch'); raise exception 'dispatch after cancel accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%' or sqlerrm like '%DISPATCH_INTENT_REQUIRED%'; end; begin perform public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0); raise exception 'retry after cancel accepted'; exception when others then assert sqlerrm like '%CANCELLATION_REQUESTED%'; end; assert public.compute_worker_transition(j,a,l,'cancelled')='cancelled'; assert (select state='cancelled' from public.compute_jobs where id=j);
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-dispatched',repeat('2',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','cancel-dispatched-worker'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'cancel-op'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' and cancellation_requested_at is not null from public.compute_jobs where id=j); select recovery_token into rt from public.compute_job_attempts where id=a; assert public.reconcile_compute_recovery(j,a,rt,'requeue',true)='cancelled';
end$$;
-- Per-creator concurrency with global capacity >1 and cross-workload coexistence.
do $$ declare t1 uuid; t2 uuid; i1 uuid; v1 uuid; begin
 update public.compute_jobs set available_at=now()+interval '1 hour' where state='queued'; select job_id into t1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','trainer','con-t1',repeat('3',64),'{}','standard'); select job_id into t2 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','trainer','con-t2',repeat('4',64),'{}','og'); select job_id into i1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','con-i',repeat('5',64),'{}','standard'); select job_id into v1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','video','con-v',repeat('6',64),'{}','standard');
 perform * from public.claim_compute_job('trainer','con-trainer'); perform * from public.claim_compute_job('image','con-image'); perform * from public.claim_compute_job('video','con-video'); assert (select count(*)=1 from public.compute_jobs where id in(t1,t2) and state='queued'); assert (select count(*)=3 from public.compute_jobs where owner_id='10000000-0000-4000-8000-000000000001' and state='claimed' and workload in ('trainer','image','video'));
end$$;
-- Fairness score: OG bounded advantage, old standard non-starvation, FIFO and lone-lane utilization.
do $$ declare s_old uuid; s_new uuid; og uuid; got uuid; begin
 -- use stitch because no active creator/workload conflict from concurrent job (it remains queued).
 select job_id into s_old from public.submit_compute_job('10000000-0000-4000-8000-000000000002','stitch','fair-old',repeat('7',64),'{}','standard'); select job_id into s_new from public.submit_compute_job('10000000-0000-4000-8000-000000000003','stitch','fair-new',repeat('8',64),'{}','standard'); select job_id into og from public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','fair-og',repeat('9',64),'{}','og');
 update public.compute_jobs set queued_at=now()-interval '2 minutes' where id=s_old; update public.compute_jobs set queued_at=now() where id in (s_new,og); update public.compute_jobs set available_at=now()+interval '1 hour' where workload='stitch' and id not in(s_old,s_new,og);
 select job_id into got from public.claim_compute_job('stitch','fair-1'); assert got=s_old, 'old standard did not win'; -- sufficiently old standard wins.
 update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=got; update public.compute_job_attempts set finished_at=now() where job_id=got;
 select job_id into got from public.claim_compute_job('stitch','fair-2'); assert got=og, 'OG advantage failed'; -- comparable age OG advantage.
 update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=got; update public.compute_job_attempts set finished_at=now() where job_id=got;
 select job_id into got from public.claim_compute_job('stitch','fair-3'); assert got=s_new, 'standard-only capacity failed'; -- standard-only capacity used.
end$$;
-- Spend denial releases slots; reservations/settlement are idempotent and net to actual.
do $$ declare j uuid; a uuid; l uuid; i integer; begin
 update public.compute_spend_policies set enabled=false; select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','video','missing-policy',repeat('a',64),'{}','standard'); for i in 1..4 loop update public.compute_jobs set available_at=now() where id=j; select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','missing-policy-worker-'||i); assert not public.authorize_compute_dispatch(j,a,l,100); end loop; assert (select state='queued' and lease_token is null and retry_count=0 and attempt_count=4 from public.compute_jobs where id=j); assert (select finished_at is not null from public.compute_job_attempts where id=a);
update public.compute_spend_policies set enabled=true; end$$;
-- Clear active test jobs before cost cases.
update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state in ('claimed','running'); update public.compute_job_attempts set finished_at=coalesce(finished_at,now()) where finished_at is null and recovery_token is null;
truncate public.compute_cost_ledger,public.compute_spend_threshold_events; update public.compute_spend_policies set daily_limit_micros=1000,monthly_limit_micros=1000,video_job_limit_micros=600,enabled=true where version=1;
do $$ declare j uuid; a uuid; l uuid; begin
 update public.compute_jobs set available_at=now()+interval '1 hour' where state='queued'; select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','image','cost',repeat('b',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','cost-worker'); assert public.authorize_compute_dispatch(j,a,l,400); assert public.authorize_compute_dispatch(j,a,l,400);
 begin perform public.authorize_compute_dispatch(j,a,l,399); raise exception 'reservation conflict accepted'; exception when others then assert sqlerrm like '%RESERVATION_CONFLICT%'; end;
 assert (select count(*)=0 from public.compute_spend_threshold_events); perform public.compute_worker_transition(j,a,l,'start'); begin perform public.record_compute_actual_cost(j,a,l,1100,123,'{}'); raise exception 'cost without dispatch accepted'; exception when others then assert sqlerrm like '%EXECUTION_EVIDENCE_REQUIRED%'; end; perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'cost-op'); perform public.record_compute_actual_cost(j,a,l,1100,123,'{}'); perform public.record_compute_actual_cost(j,a,l,1100,123,'{}'); assert (select count(*)=8 from public.compute_spend_threshold_events);
 begin perform public.record_compute_actual_cost(j,a,l,1101,123,'{}'); raise exception 'actual conflict accepted'; exception when others then assert sqlerrm like '%ACTUAL_COST_CONFLICT%'; end;
 assert (select sum(amount_micros)=1100 from public.compute_cost_ledger where attempt_id=a); assert (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='release'); assert public.record_compute_cost_correction(j,'adjustment-1',100,'PROVIDER_RECONCILIATION')=public.record_compute_cost_correction(j,'adjustment-1',100,'PROVIDER_RECONCILIATION'); begin perform public.record_compute_cost_correction(j,'adjustment-1',101,'PROVIDER_RECONCILIATION'); raise exception 'correction conflict accepted'; exception when others then assert sqlerrm like '%COST_CORRECTION_CONFLICT%'; end; update public.compute_spend_policies set daily_limit_micros=1,monthly_limit_micros=1 where version=1; assert public.compute_worker_transition(j,a,l,'success')='succeeded';
end$$;
-- Video fuse and cap denial do not strand claims.
update public.compute_spend_policies set daily_limit_micros=1000,monthly_limit_micros=1000 where version=1;
do $$ declare j uuid; a uuid; l uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','fuse',repeat('c',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','fuse-worker'); assert not public.authorize_compute_dispatch(j,a,l,601); assert (select state='queued' and lease_token is null from public.compute_jobs where id=j);
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','image','cap',repeat('d',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','cap-worker'); assert not public.authorize_compute_dispatch(j,a,l,301); assert (select state='queued' and lease_token is null from public.compute_jobs where id=j);
end$$;
select 'compute job plane postgres integration passed';
