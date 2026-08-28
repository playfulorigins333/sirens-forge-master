-- Forward-only repair for impossible legacy Trainer active states.
-- Preserve datasets and artifacts; only the creator-facing state/error are corrected.
update public.user_loras as l
set status = 'failed',
    error_message = 'TRAINER_STATE_ORPHANED',
    updated_at = pg_catalog.clock_timestamp()
where l.status in ('queued', 'training')
  and not (
    l.artifact_r2_bucket is not null and btrim(l.artifact_r2_bucket) <> ''
    and l.artifact_r2_key is not null and btrim(l.artifact_r2_key) <> ''
  )
  and not exists (
    select 1
    from public.compute_jobs as j
    where j.id::text = l.training_job_id
      and j.owner_id = l.user_id
      and j.workload = 'trainer'
      and j.state in ('queued', 'claimed', 'running', 'recovering', 'cancel_requested')
      and j.request_payload ->> 'identity_id' = l.id::text
  );
