-- FV-40ET one-time safe audit-log backfill for the already-created Fanvue internal single-post job.
-- Safety: this only writes public.autopost_job_logs when the exact safe log row is missing.
-- It does not call Fanvue, upload media, create posts, dispatch, schedule, or change platformRegistry.

insert into public.autopost_job_logs (job_id, level, message, meta)
select
  '62231d17-7dab-4d1f-bc7d-aeb54dfeec7e'::uuid,
  'INFO',
  'fanvue_internal_single_post_proof_persisted',
  '{
    "platform": "fanvue",
    "result_status": "POSTED",
    "provider_post_uuid_present": true,
    "backfill": true,
    "source": "fv_40et_audit_log_backfill"
  }'::jsonb
where not exists (
  select 1
  from public.autopost_job_logs
  where job_id = '62231d17-7dab-4d1f-bc7d-aeb54dfeec7e'::uuid
    and message = 'fanvue_internal_single_post_proof_persisted'
    and coalesce(meta->>'source', '') = 'fv_40et_audit_log_backfill'
);
