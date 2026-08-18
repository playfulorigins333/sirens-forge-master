# CPQ Fanvue scheduler Production activation runbook

This is a later Production procedure, not authorization to deploy, write the database, change an environment, invoke Fanvue, or publish content. Never print, select, paste, log, or capture an authentication secret.

## Required sequence

1. Merge the approved PR to `main` without bypassing required checks.
2. Deploy that exact `main` commit to Production, then independently verify the deployment and `www.sirensforge.vip` alias/public response.
3. Take and verify a fresh Production database backup.
4. Confirm that the existing Vercel `CRON_SECRET` or `VERCEL_CRON_SECRET` is configured without exposing its value.
5. Provision that **same existing value** into Supabase Vault under the exact name `fanvue_cpq_cron_secret`. If the existing value cannot be safely recovered, **stop**: do not guess it and do not silently rotate it.
6. After separate explicit Production database authorization, apply only `supabase/migrations/20260818180000_enable_pg_net_for_cpq_fanvue_scheduler.sql` and read-only verify `pg_net`.
7. Read-only verify the Fanvue job, attempt, and trust baseline. Investigate any unexpected runnable or in-flight state before continuing.
8. Obtain a separate explicit human authorization to execute `supabase/manual/cpq_fanvue_scheduler_activation.sql`.
9. Execute the activation SQL. Verify exactly one `sirens_forge_cpq_fanvue_runner` row exists with schedule `* * * * *`.
10. Verify its stored command dynamically references `vault.decrypted_secrets` and the exact CPQ endpoint. Do not display the command in shared logs or screenshots, and verify that it does not contain the actual secret.
11. Inspect recent `cron.job_run_details`, then recent `net._http_response` status/error metadata in the activation time window without selecting response headers, bodies, request headers, or secrets.
12. Verify Fanvue jobs, attempts, and application state after scheduler runs. Do not manually create a provider post solely to prove scheduler operation. Live provider verification remains separately authorized.

## Safe read-only verification queries

Run these only in an authorized Production read-only session. Keep output private and redact identifiers where appropriate.

```sql
select extname, extversion
from pg_extension
where extname = 'pg_net';
```

```sql
select jobid, jobname, schedule, active,
       command like '%https://www.sirensforge.vip/api/creator-publishing-queue/fanvue/run%' as exact_endpoint,
       command like '%vault.decrypted_secrets%' as dynamic_vault_lookup
from cron.job
where jobname = 'sirens_forge_cpq_fanvue_runner';
```

```sql
select runid, jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'sirens_forge_cpq_fanvue_runner')
order by start_time desc
limit 20;
```

`net._http_response` does not retain the request URL. First verify the canonical cron command above, then correlate only responses created after the authorized activation time supplied as a bound parameter:

```sql
select id, status_code, timed_out, error_msg, created
from net._http_response
where created >= :authorized_activation_time
order by created desc
limit 20;
```

```sql
select count(*) as fanvue_job_count
from public.creator_publishing_platform_jobs
where target_platform = 'fanvue';

select count(*) as fanvue_attempt_count
from public.creator_publishing_fanvue_attempts;
```

These queries deliberately never read `vault.decrypted_secrets.decrypted_secret`, HTTP headers, or response bodies.
