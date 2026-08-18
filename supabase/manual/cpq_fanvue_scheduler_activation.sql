-- OPERATOR-RUN ONLY: applying this file is a separately authorized database write.
-- Prerequisites: Vault must contain exactly one enabled secret named
-- cpq_fanvue_scheduler_base_url and one named cpq_fanvue_scheduler_cron_secret.
-- The base URL must not end in a slash.

do $activation$
declare
  v_existing_job_id bigint;
  v_conflicting_jobs integer;
begin
  if (select count(*) from vault.decrypted_secrets where name = 'cpq_fanvue_scheduler_base_url') <> 1 then
    raise exception 'CPQ Fanvue scheduler base URL is not uniquely configured';
  end if;
  if (select count(*) from vault.decrypted_secrets where name = 'cpq_fanvue_scheduler_cron_secret') <> 1 then
    raise exception 'CPQ Fanvue scheduler secret is not uniquely configured';
  end if;
  if (select decrypted_secret ~ '/$' from vault.decrypted_secrets where name = 'cpq_fanvue_scheduler_base_url') then
    raise exception 'CPQ Fanvue scheduler base URL must not end in a slash';
  end if;

  select count(*)
    into v_conflicting_jobs
    from cron.job
   where command like '%/api/creator-publishing-queue/fanvue/run%'
     and jobname <> 'sirens_forge_cpq_fanvue_runner';
  if v_conflicting_jobs <> 0 then
    raise exception 'A different recurring trigger already targets the CPQ Fanvue runner';
  end if;

  select jobid into v_existing_job_id
    from cron.job
   where jobname = 'sirens_forge_cpq_fanvue_runner';
  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'sirens_forge_cpq_fanvue_runner',
    '* * * * *',
    $run$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'cpq_fanvue_scheduler_base_url') || '/api/creator-publishing-queue/fanvue/run',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cpq_fanvue_scheduler_cron_secret')
        ),
        timeout_milliseconds := 55000
      );
    $run$
  );
end
$activation$;
