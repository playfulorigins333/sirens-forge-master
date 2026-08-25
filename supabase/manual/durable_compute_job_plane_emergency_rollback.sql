-- MANUAL EMERGENCY ROLLBACK ONLY. Requires explicit human authorization.
-- First disable DURABLE_COMPUTE_JOBS_ENABLED and all Pass 3 workers, then verify no
-- claimed/running/recovering/cancel_requested jobs remain. Export all compute evidence.
-- This removes only the Pass 2 compute plane; it does not touch generations,
-- user_loras, private-media, content_generation_jobs, or publishing tables.
begin;
drop function if exists public.record_compute_actual_cost(uuid,uuid,uuid,bigint,bigint,jsonb);
drop function if exists public.record_compute_cost_correction(uuid,text,bigint,text);
drop function if exists public.authorize_compute_dispatch(uuid,uuid,uuid,bigint);
drop function if exists public.cancel_compute_job(uuid,uuid);
drop function if exists public.creator_compute_status(uuid,uuid);
drop function if exists public.recover_stale_compute_jobs();
drop function if exists public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text);
drop function if exists public.heartbeat_compute_recovery(uuid,uuid,uuid);
drop function if exists public.compute_recovery_signal(uuid,uuid,uuid);
drop function if exists public.claim_compute_recovery(public.compute_workload,text);
drop function if exists public.retry_compute_pre_dispatch(uuid,uuid,uuid,text,integer);
drop function if exists public.heartbeat_compute_job(uuid,uuid,uuid);
drop function if exists public.compute_worker_signal(uuid,uuid,uuid);
drop function if exists public.mark_compute_provider_dispatch(uuid,uuid,uuid,text);
drop function if exists public.begin_compute_provider_dispatch(uuid,uuid,uuid);
drop function if exists public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb);
drop function if exists public.claim_compute_job(public.compute_workload,text);
drop function if exists public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text);
drop function if exists public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text);
drop function if exists public.emit_compute_spend_thresholds(uuid);
drop function if exists public.release_compute_reservation(uuid);
drop function if exists public.compute_creator_result(jsonb);
drop function if exists public.compute_safe_error(text);
drop table if exists public.compute_spend_threshold_events,public.compute_cost_ledger,public.compute_job_attempts,public.compute_jobs,public.compute_spend_policies,public.compute_scheduler_policies;
drop type if exists public.compute_cost_event_kind; drop type if exists public.compute_job_state; drop type if exists public.compute_workload;
commit;
