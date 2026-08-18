-- OPERATOR-RUN ONLY: applying this file is a separately authorized database write.
-- Prerequisite: Vault must contain exactly one nonblank decrypted secret named
-- fanvue_cpq_cron_secret. The value is resolved dynamically by every cron run.

do $activation$
declare
  v_existing_job_id bigint;
  v_conflicting_jobs integer;
begin
  if (select count(*) from vault.decrypted_secrets where name = 'fanvue_cpq_cron_secret') <> 1 then
    raise exception 'CPQ Fanvue scheduler secret is not uniquely configured';
  end if;
  if (select nullif(btrim(decrypted_secret), '') is null from vault.decrypted_secrets where name = 'fanvue_cpq_cron_secret') then
    raise exception 'CPQ Fanvue scheduler secret is empty';
  end if;

  select count(*)
    into v_conflicting_jobs
    from cron.job
   where command like '%https://www.sirensforge.vip/api/creator-publishing-queue/fanvue/run%'
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
        url := 'https://www.sirensforge.vip/api/creator-publishing-queue/fanvue/run',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fanvue_cpq_cron_secret')
        ),
        timeout_milliseconds := 55000
      );
    $run$
  );
end
$activation$;
