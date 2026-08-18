-- OPERATOR-RUN ONLY: applying this file is a separately authorized database write.
-- This removes only the CPQ Fanvue trigger and does not alter legacy AutoPost jobs.
do $deactivation$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'sirens_forge_cpq_fanvue_runner'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$deactivation$;
