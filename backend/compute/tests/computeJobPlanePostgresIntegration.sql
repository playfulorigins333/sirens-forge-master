\set ON_ERROR_STOP on
-- Migration blast radius and concurrent idempotency.
do $$ begin
 assert has_table_privilege('anon','public.compute_unrelated_grant_sentinel','select');
 assert has_table_privilege('authenticated','public.compute_unrelated_grant_sentinel','select');
 assert has_table_privilege('authenticated','public.compute_unrelated_grant_sentinel','insert');
 assert (select count(*)=1 from public.compute_jobs where owner_id='10000000-0000-4000-8000-000000000001' and workload='stitch' and idempotency_key='concurrent');
 assert (select count(*)=1 from public.compute_cost_ledger where kind='reservation' and amount_micros=600 and job_id in (select id from public.compute_jobs where idempotency_key like 'concurrent-spend-%'));
 assert (select coalesce(sum(amount_micros),0)<=1000 from public.compute_cost_ledger where kind='reservation');
 assert (select count(*)=1 from public.compute_jobs where idempotency_key like 'concurrent-spend-%' and state='queued' and lease_token is null and retry_count=0);
end$$;
update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where idempotency_key like 'concurrent-spend-%' and state in ('claimed','running');
update public.compute_job_attempts set finished_at=coalesce(finished_at,now()),outcome_class=coalesce(outcome_class,'test_cleanup') where job_id in (select id from public.compute_jobs where idempotency_key like 'concurrent-spend-%') and finished_at is null;
delete from public.compute_cost_ledger where job_id in (select id from public.compute_jobs where idempotency_key like 'concurrent-spend-%');
update public.compute_spend_policies set daily_limit_micros=1000000,monthly_limit_micros=1000000 where version=1;
-- Sequential idempotency and conflict.
do $$ declare a uuid; b uuid; begin
 select job_id into a from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('b',64),'{}','standard');
 select job_id into b from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('b',64),'{}','standard'); assert a=b;
 begin perform * from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','same',repeat('c',64),'{}','standard'); raise exception 'expected conflict'; exception when others then assert sqlerrm like '%IDEMPOTENCY_CONFLICT%'; end;
end$$;
do $$ begin
 assert public.compute_creator_result(jsonb_build_object('asset_ids',jsonb_build_array('30000000-0000-4000-8000-000000000001','not-a-uuid')))='{}'::jsonb;
 assert public.compute_creator_result(jsonb_build_object('asset_ids',jsonb_build_array('30000000-0000-4000-8000-000000000001'))) ? 'asset_ids';
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
-- Active workers can observe creator cancellation without direct table access.
do $$ declare j uuid; a uuid; l uuid; state public.compute_job_state; cancelled boolean; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','image','worker-signal',repeat('3',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','signal-worker');
 select job_state,cancellation_requested into state,cancelled from public.compute_worker_signal(j,a,l); assert state='claimed' and not cancelled, 'unexpected initial cancellation signal';
 perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j);
 select job_state,cancellation_requested into state,cancelled from public.compute_worker_signal(j,a,l); assert state='cancel_requested' and cancelled, 'creator cancellation not signalled';
 begin perform * from public.compute_worker_signal(j,a,gen_random_uuid()); raise exception 'wrong signal token accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
 assert public.compute_worker_transition(j,a,l,'cancelled')='cancelled';
end$$;
-- Bounded normal pre-dispatch retry and next ordinal.
do $$ declare j uuid; a uuid; l uuid; a2 uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','image','normal-retry',repeat('0',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','retry-1'); assert public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0)='queued'; assert (select retry_count=1 from public.compute_jobs where id=j);
 select attempt_id,lease_token into a2,l from public.claim_compute_job('image','retry-2'); assert a2<>a; assert (select ordinal=2 from public.compute_job_attempts where id=a2); assert public.retry_compute_pre_dispatch(j,a2,l,'TRANSIENT_FAILURE',0)='failed'; assert (select retry_count=2 from public.compute_jobs where id=j);
end$$;
-- Dispatch locking, post-dispatch recovery, no normal claim, and explicit reconciliation.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; old_rl uuid; renewed timestamptz; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','image','recover',repeat('d',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','dispatch-worker');
 assert public.compute_worker_transition(j,a,l,'start')='running';
 assert public.compute_worker_transition(j,a,l,'start')='running';
 begin perform public.compute_worker_transition(j,a,gen_random_uuid(),'start'); raise exception 'wrong start token accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
 assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'opaque-op'); perform public.mark_compute_provider_dispatch(j,a,l,'opaque-op');
 begin perform public.mark_compute_provider_dispatch(j,a,l,'different-op'); raise exception 'operation replacement accepted'; exception when others then assert sqlerrm like '%PROVIDER_OPERATION_CONFLICT%'; end;
 begin perform public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0); raise exception 'post dispatch retry accepted'; exception when others then assert sqlerrm like '%POST_DISPATCH_RETRY_FORBIDDEN%'; end;
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' from public.compute_jobs where id=j); assert (select provider_operation_ref='opaque-op' from public.compute_job_attempts where id=a); assert not exists(select 1 from public.claim_compute_job('image','duplicate-worker') where job_id=j);
 select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('image','recovery-worker-1') where job_id=j; assert rt is not null and rl is not null;
 assert not exists(select 1 from public.claim_compute_recovery('image','duplicate-recovery-worker') where job_id=j), 'live recovery lease claimed twice';
 renewed:=public.heartbeat_compute_recovery(j,a,rl); assert renewed>(select recovery_heartbeat_at from public.compute_job_attempts where id=a);
 begin perform public.heartbeat_compute_recovery(j,a,gen_random_uuid()); raise exception 'wrong recovery heartbeat accepted'; exception when others then assert sqlerrm like '%RECOVERY_LEASE_MISMATCH%'; end;
 old_rl:=rl; update public.compute_job_attempts set recovery_lease_expires_at=now()-interval '1 second' where id=a;
 select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('image','recovery-worker-2') where job_id=j; assert rl<>old_rl, 'expired recovery lease token reused';
 begin perform public.reconcile_compute_recovery(j,a,rt,old_rl,'succeeded',false,null,jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001','provider','secret'),700,12,'opaque-op'); raise exception 'expired recovery authority accepted'; exception when others then assert sqlerrm like '%RECOVERY_AUTHORITY_MISMATCH%'; end;
 begin perform public.reconcile_compute_recovery(j,a,rt,rl,'requeue',false); raise exception 'unsafe requeue accepted'; exception when others then assert sqlerrm like '%PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED%'; end;
 assert public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001','provider','secret'),700,12,'opaque-op')='succeeded';
 assert public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001','provider','secret'),700,12,'opaque-op')='succeeded';
 assert (select recovery_token=rt and recovery_lease_token is null and recovery_fingerprint is not null from public.compute_job_attempts where id=a);
 assert (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='actual');
 begin perform public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001'),701,12,'opaque-op'); raise exception 'conflicting recovery replay accepted'; exception when others then assert sqlerrm like '%RECOVERY_REPLAY_CONFLICT%'; end;
 assert (select result_reference=jsonb_build_object('generation_id','30000000-0000-4000-8000-000000000001') from public.creator_compute_status('10000000-0000-4000-8000-000000000002',j));
end$$;
-- A live recovery worker can observe creator cancellation without direct table reads.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; state public.compute_job_state; cancelled boolean; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','recovery-signal',repeat('7',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','recovery-signal-dispatch-worker');
 assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'recovery-signal-op');
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' from public.compute_jobs where id=j);
 select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('video','recovery-signal-worker') where job_id=j;
 select job_state,cancellation_requested into state,cancelled from public.compute_recovery_signal(j,a,rl); assert state='recovering' and not cancelled, 'unexpected initial recovery cancellation signal';
 perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j);
 select job_state,cancellation_requested into state,cancelled from public.compute_recovery_signal(j,a,rl); assert state='recovering' and cancelled, 'creator cancellation not signalled to recovery worker';
 begin perform * from public.compute_recovery_signal(j,a,gen_random_uuid()); raise exception 'wrong recovery signal token accepted'; exception when others then assert sqlerrm like '%RECOVERY_LEASE_MISMATCH%'; end;
 update public.compute_job_attempts set recovery_lease_expires_at=now()-interval '1 second' where id=a;
 begin perform * from public.compute_recovery_signal(j,a,rl); raise exception 'expired recovery signal lease accepted'; exception when others then assert sqlerrm like '%RECOVERY_LEASE_MISMATCH%'; end;
 select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('video','recovery-signal-cleanup-worker') where job_id=j;
 assert public.reconcile_compute_recovery(j,a,rt,rl,'requeue',true)='cancelled';
end$$;
-- Safe requeue requires positive non-execution evidence.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','trainer','reconcile-requeue',repeat('e',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('trainer','reconcile-worker'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'trainer-op'); update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('trainer','requeue-recovery-worker') where job_id=j; assert public.reconcile_compute_recovery(j,a,rt,rl,'requeue',true)='queued';
end$$;
-- A durable dispatch intent closes the pre-network crash window.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; begin
 update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state in ('claimed','running','recovering','cancel_requested');
 update public.compute_job_attempts set finished_at=coalesce(finished_at,now()),outcome_class=coalesce(outcome_class,'test_cleanup') where finished_at is null;
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000002','image','dispatch-intent-crash',repeat('0',64),'{}','standard');
 select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','intent-worker');
 assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l);
 update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs();
 assert (select state='recovering' from public.compute_jobs where id=j); assert (select provider_operation_ref is null and provider_dispatch_intent_at is not null from public.compute_job_attempts where id=a);
 assert (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='reservation'); assert (select count(*)=0 from public.compute_cost_ledger where attempt_id=a and kind='release');
 assert not exists(select 1 from public.claim_compute_job('image','must-not-duplicate') where job_id=j);
 select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('image','intent-recovery-worker') where job_id=j;
 assert public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,jsonb_build_object('result_id','30000000-0000-4000-8000-000000000002'),0,0,'discovered-after-crash')='succeeded';
 assert public.reconcile_compute_recovery(j,a,rt,rl,'succeeded',false,null,jsonb_build_object('result_id','30000000-0000-4000-8000-000000000002'),0,0,'discovered-after-crash')='succeeded';
 assert (select provider_operation_ref='discovered-after-crash' and actual_cost_micros=0 from public.compute_job_attempts where id=a);
 assert (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='release') and (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='actual');
end$$;
-- Cancellation: queued terminal, stale pre-dispatch terminal, dispatched ambiguity reconciles.
do $$ declare j uuid; a uuid; l uuid; rt uuid; rl uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-queued',repeat('f',64),'{}','standard'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); assert (select state='cancelled' from public.compute_jobs where id=j); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j);
 begin perform public.cancel_compute_job('10000000-0000-4000-8000-000000000001',j); raise exception 'wrong owner accepted'; exception when others then assert sqlerrm like '%COMPUTE_JOB_NOT_FOUND%'; end;
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-stale',repeat('1',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','cancel-worker'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); begin perform public.mark_compute_provider_dispatch(j,a,l,'must-not-dispatch'); raise exception 'dispatch after cancel accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%' or sqlerrm like '%DISPATCH_INTENT_REQUIRED%'; end; begin perform public.retry_compute_pre_dispatch(j,a,l,'TRANSIENT_FAILURE',0); raise exception 'retry after cancel accepted'; exception when others then assert sqlerrm like '%CANCELLATION_REQUESTED%'; end; assert public.compute_worker_transition(j,a,l,'cancelled')='cancelled'; assert (select state='cancelled' from public.compute_jobs where id=j); assert (select coalesce(sum(amount_micros),0)=0 from public.compute_cost_ledger where attempt_id=a);
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','cancel-dispatched',repeat('2',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','cancel-dispatched-worker'); assert public.authorize_compute_dispatch(j,a,l,100); perform public.begin_compute_provider_dispatch(j,a,l); perform public.mark_compute_provider_dispatch(j,a,l,'cancel-op'); perform public.cancel_compute_job('10000000-0000-4000-8000-000000000003',j); update public.compute_jobs set lease_expires_at=now()-interval '1 second' where id=j; perform public.recover_stale_compute_jobs(); assert (select state='recovering' and cancellation_requested_at is not null from public.compute_jobs where id=j); select recovery_token,recovery_lease_token into rt,rl from public.claim_compute_recovery('video','cancel-recovery-worker') where job_id=j; assert public.reconcile_compute_recovery(j,a,rt,rl,'requeue',true)='cancelled';
end$$;
-- Per-creator concurrency with global capacity >1 and cross-workload coexistence.
do $$ declare t1 uuid; t2 uuid; i1 uuid; v1 uuid; begin
 update public.compute_jobs set available_at=now()+interval '1 hour' where state='queued'; select job_id into t1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','trainer','con-t1',repeat('3',64),'{}','standard'); select job_id into t2 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','trainer','con-t2',repeat('4',64),'{}','og'); select job_id into i1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','con-i',repeat('5',64),'{}','standard'); select job_id into v1 from public.submit_compute_job('10000000-0000-4000-8000-000000000001','video','con-v',repeat('6',64),'{}','standard');
 perform * from public.claim_compute_job('trainer','con-trainer'); perform * from public.claim_compute_job('image','con-image'); perform * from public.claim_compute_job('video','con-video'); assert (select count(*)=1 from public.compute_jobs where id in(t1,t2) and state='queued'); assert (select count(*)=3 from public.compute_jobs where owner_id='10000000-0000-4000-8000-000000000001' and state='claimed' and workload in ('trainer','image','video'));
end$$;
-- Fairness is locked to Trainer/Image/Video; Stitch has neither OG boost nor creator limit.
do $$ declare w public.compute_workload; s_old uuid; s_same uuid; og uuid; got uuid; stamp timestamptz; stitch_one uuid; stitch_two uuid; begin
 update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state in ('claimed','running','recovering','cancel_requested');
 update public.compute_job_attempts set finished_at=coalesce(finished_at,now()),outcome_class=coalesce(outcome_class,'test_cleanup') where finished_at is null;
 foreach w in array array['trainer','image','video']::public.compute_workload[] loop
  stamp:=clock_timestamp();
  select job_id into s_old from public.submit_compute_job('10000000-0000-4000-8000-000000000002',w,'fair-old-'||w,repeat('7',64),'{}','standard');
  select job_id into s_same from public.submit_compute_job('10000000-0000-4000-8000-000000000003',w,'fair-same-'||w,repeat('8',64),'{}','standard');
  select job_id into og from public.submit_compute_job('10000000-0000-4000-8000-000000000001',w,'fair-og-'||w,repeat('9',64),'{}','og');
  update public.compute_jobs set queued_at=stamp-interval '2 minutes' where id=s_old; update public.compute_jobs set queued_at=stamp where id in(s_same,og);
  update public.compute_jobs set available_at=now()+interval '1 hour' where workload=w and state='queued' and id not in(s_old,s_same,og);
  select job_id into got from public.claim_compute_job(w,'fair-old-'||w); assert got=s_old, w||' old standard did not beat newer OG';
  update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=got; update public.compute_job_attempts set finished_at=now(),outcome_class='test_cleanup' where job_id=got;
  select job_id into got from public.claim_compute_job(w,'fair-og-'||w); assert got=og, w||' comparable OG advantage failed';
  update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=got; update public.compute_job_attempts set finished_at=now(),outcome_class='test_cleanup' where job_id=got;
  select job_id into got from public.claim_compute_job(w,'fair-fifo-'||w); assert got=s_same, w||' deterministic same-tier ordering failed';
  update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=got; update public.compute_job_attempts set finished_at=now(),outcome_class='test_cleanup' where job_id=got;
 end loop;
 stamp:=clock_timestamp();
 select job_id into s_old from public.submit_compute_job('10000000-0000-4000-8000-000000000002','stitch','stitch-standard',repeat('a',64),'{}','standard');
 select job_id into og from public.submit_compute_job('10000000-0000-4000-8000-000000000003','stitch','stitch-og',repeat('b',64),'{}','og');
 update public.compute_jobs set queued_at=stamp-interval '1 second' where id=s_old; update public.compute_jobs set queued_at=stamp where id=og;
 update public.compute_jobs set available_at=now()+interval '1 hour' where workload='stitch' and state='queued' and id not in(s_old,og);
 select job_id into got from public.claim_compute_job('stitch','stitch-no-boost'); assert got=s_old, 'Stitch received an OG boost';
 update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id in(s_old,og); update public.compute_job_attempts set finished_at=now(),outcome_class='test_cleanup' where job_id=s_old;
 select job_id into stitch_one from public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','stitch-active-1',repeat('c',64),'{}','standard');
 select job_id into stitch_two from public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','stitch-active-2',repeat('d',64),'{}','standard');
 perform * from public.claim_compute_job('stitch','stitch-worker-1'); perform * from public.claim_compute_job('stitch','stitch-worker-2');
 assert (select count(*)=2 from public.compute_jobs where id in(stitch_one,stitch_two) and state='claimed'), 'same-creator Stitch capacity was restricted';
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
 assert (select sum(amount_micros)=1100 from public.compute_cost_ledger where attempt_id=a); assert (select count(*)=1 from public.compute_cost_ledger where attempt_id=a and kind='release'); assert public.record_compute_cost_correction(j,'adjustment-1',100,'PROVIDER_RECONCILIATION')=public.record_compute_cost_correction(j,'adjustment-1',100,'PROVIDER_RECONCILIATION'); begin perform public.record_compute_cost_correction(j,'adjustment-1',101,'PROVIDER_RECONCILIATION'); raise exception 'correction conflict accepted'; exception when others then assert sqlerrm like '%COST_CORRECTION_CONFLICT%'; end; update public.compute_spend_policies set daily_limit_micros=1,monthly_limit_micros=1 where version=1; assert public.compute_worker_transition(j,a,l,'success')='succeeded'; assert public.compute_worker_transition(j,a,l,'success')='succeeded';
 begin perform public.compute_worker_transition(j,a,gen_random_uuid(),'success'); raise exception 'wrong terminal token accepted'; exception when others then assert sqlerrm like '%LEASE_MISMATCH%'; end;
 begin perform public.compute_worker_transition(j,a,l,'failure'); raise exception 'conflicting terminal replay accepted'; exception when others then assert sqlerrm like '%TERMINAL_TRANSITION_CONFLICT%'; end;
end$$;
-- Video fuse and cap denial do not strand claims.
update public.compute_spend_policies set daily_limit_micros=1000,monthly_limit_micros=1000 where version=1;
do $$ declare j uuid; a uuid; l uuid; begin
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','video','fuse',repeat('c',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('video','fuse-worker'); assert not public.authorize_compute_dispatch(j,a,l,601); assert (select state='queued' and lease_token is null from public.compute_jobs where id=j);
 select job_id into j from public.submit_compute_job('10000000-0000-4000-8000-000000000003','image','cap',repeat('d',64),'{}','standard'); select job_id,attempt_id,lease_token into j,a,l from public.claim_compute_job('image','cap-worker'); assert not public.authorize_compute_dispatch(j,a,l,301); assert (select state='queued' and lease_token is null from public.compute_jobs where id=j);
end$$;
select 'compute job plane postgres integration passed';
