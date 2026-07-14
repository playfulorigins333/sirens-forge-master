// TASK17A_SCENARIO_START: claim_vs_job_cancel_concurrency
// TASK17A_SCENARIO_START: claim_vs_plan_cancel_concurrency
// TASK17A_SCENARIO_START: recovery_vs_job_cancel_concurrency
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const psqlBin = process.env.PSQL || 'psql'
const probe = spawnSync(psqlBin, ['--version'], { encoding: 'utf8' })
if (probe.status !== 0) { console.error('[task17a-cancellation-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
const databaseUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const logPath = 'task17a-postgres-diagnostics.log'
const tmp = mkdtempSync(join(tmpdir(), 'task17a-cancel-race-'))
function psql(label, sql, expectOk = true) {
  const file = join(tmp, `${label.replace(/[^a-z0-9_-]/gi, '_')}.sql`)
  writeFileSync(file, sql)
  const res = spawnSync(psqlBin, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-f', file], { encoding: 'utf8' })
  appendFileSync(logPath, `\n## cancellation concurrency ${label}\n${res.stdout || ''}${res.stderr || ''}`)
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (expectOk && res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
  return res
}
function setup(seed, mode) {
  psql(`setup-${mode}`, `
    \\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
    select task17a_test.reset_fixture(${seed},'scheduled_internally','scheduled_internally',true) as f \\gset
    select task17a_test.set_valid_schedule_phase((:'f'::jsonb->>'job')::uuid,'after_operator_due');
    insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision)
    values(task17a_test.uuid_for('92790000-0000-4000-8000-',${seed}),(:'f'::jsonb->>'creator')::uuid,(:'f'::jsonb->>'plan')::uuid,(:'f'::jsonb->>'job')::uuid,'publish_due','pending',clock_timestamp()-interval '1 minute',1)
    on conflict do nothing;
    select :'f' as fixture_json;
  `)
  const out = psql(`read-${mode}`, `select jsonb_build_object('creator',creator_id,'plan',publishing_plan_id,'job',id,'task',(select q.id from public.creator_publishing_queue_tasks q where q.content_package_id=j.content_package_id and q.creator_id=j.creator_id and q.platform_account_id=j.platform_account_id and q.target_platform=j.target_platform),'consent_version','creator-ai-twin-consent-v1','consent_hash','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') from public.creator_publishing_platform_jobs j where id=task17a_test.uuid_for('17600000-0000-4000-8000-',${seed});`)
  const match = out.stdout.match(/\{.*\}/)
  if (!match) throw new Error(`could not parse ${mode} fixture`)
  return JSON.parse(match[0])
}
async function race(label, fixture, aSql, bSql) {
  console.log(`TASK17A_SCENARIO_START: ${label}`)
  appendFileSync(logPath, `\nTASK17A_SCENARIO_START: ${label}\n`)
  const barrier = new Date(Date.now() + 1500).toISOString()
  const aFile = join(tmp, `${label}-a.sql`)
  const bFile = join(tmp, `${label}-b.sql`)
  writeFileSync(aFile, `set lock_timeout='10s'; select pg_sleep(greatest(0, extract(epoch from timestamp with time zone '${barrier}' - clock_timestamp()))); ${aSql}`)
  writeFileSync(bFile, `set lock_timeout='10s'; select pg_sleep(greatest(0, extract(epoch from timestamp with time zone '${barrier}' - clock_timestamp()))); ${bSql}`)
  const runSession = (name, file) => new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, '-v', 'ON_ERROR_STOP=0', '-X', '-f', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (error) => resolve({ name, code: 127, stdout, stderr: `${stderr}${error.message}` }))
    child.on('close', (code) => resolve({ name, code, stdout, stderr }))
  })
  const [a, b] = await Promise.all([runSession('A', aFile), runSession('B', bFile)])
  appendFileSync(logPath, `
## ${label} session A
${a.stdout || ''}${a.stderr || ''}
## ${label} session B
${b.stdout || ''}${b.stderr || ''}`)
  if (`${a.stdout}${a.stderr}${b.stdout}${b.stderr}`.match(/deadlock detected|canceling statement due to lock timeout/i)) throw new Error(`${label} deadlock or lock timeout`)
  psql(`${label}-final`, `
    do $$ begin
      if not exists(select 1 from public.creator_publishing_platform_jobs where id='${fixture.job}'::uuid and job_state='archived') then raise exception 'TASK17A_ASSERT:${label} job archived'; end if;
      if not exists(select 1 from public.creator_publishing_queue_tasks where id='${fixture.task}'::uuid and status='archived' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and posted_by is null and posted_at is null and posted_confirmation is false and final_post_url is null and final_post_url_skip_reason is null and proof_screenshot_storage_key is null and skip_or_fail_reason is null) then raise exception 'TASK17A_ASSERT:${label} queue archived unclaimed no task18'; end if;
      if exists(select 1 from public.creator_publishing_queue_tasks where id='${fixture.task}'::uuid and ((claimed_by is null)<>(claimed_at is null) or (claimed_by is null)<>(claim_token is null) or (claimed_by is null)<>(claim_expires_at is null))) then raise exception 'TASK17A_ASSERT:${label} partial ownership tuple'; end if;
      if (select count(*) from public.creator_publishing_audit_events where entity_id='${fixture.task}'::uuid and action='operator_task_claim_cancelled_by_schedule_cancellation') > 1 then raise exception 'TASK17A_ASSERT:${label} duplicate cleanup audit'; end if;
      if exists(select 1 from public.creator_publishing_audit_events where entity_id='${fixture.task}'::uuid and (before_state ? 'claim_token' or after_state ? 'claim_token')) then raise exception 'TASK17A_ASSERT:${label} claim token in audit'; end if;
    end $$;
  `)
}
try {
  const job = setup(927901, 'claim-vs-job-cancel')
  await race('claim_vs_job_cancel_concurrency', job,
    `select public.creator_publishing_claim_onlyfans_operator_task('${job.creator}','${job.task}','${job.job}','${job.consent_version}','${job.consent_hash}','raceclaim1');`,
    `select public.creator_publishing_cancel_job_schedule('${job.creator}','${job.job}','Race job cancel','racejobcancel1');`)

  const plan = setup(927902, 'claim-vs-plan-cancel')
  await race('claim_vs_plan_cancel_concurrency', plan,
    `select public.creator_publishing_claim_onlyfans_operator_task('${plan.creator}','${plan.task}','${plan.job}','${plan.consent_version}','${plan.consent_hash}','raceclaim2');`,
    `select public.creator_publishing_cancel_plan_schedule('${plan.creator}','${plan.plan}','Race plan cancel','raceplancancel1');`)
  psql('claim-vs-plan-final-plan', `do $$ begin if not exists(select 1 from public.creator_publishing_plans where id='${plan.plan}'::uuid and status='cancelled') then raise exception 'TASK17A_ASSERT: plan race plan cancelled'; end if; end $$;`)

  const recovery = setup(927903, 'recovery-vs-job-cancel')
  psql('expire-recovery-race-claim', `select public.creator_publishing_claim_onlyfans_operator_task('${recovery.creator}','${recovery.task}','${recovery.job}','${recovery.consent_version}','${recovery.consent_hash}','racerecclaim'); select task17a_test.expire_claim('${recovery.task}'::uuid);`)
  await race('recovery_vs_job_cancel_concurrency', recovery,
    `select public.creator_publishing_recover_expired_onlyfans_operator_claim('${recovery.creator}','${recovery.task}','${recovery.job}','racerecover1');`,
    `select public.creator_publishing_cancel_job_schedule('${recovery.creator}','${recovery.job}','Race recovery cancel','racereccancel');`)
} catch (error) {
  appendFileSync(logPath, `\nCANCELLATION CONCURRENCY FAILED: ${error?.stack || error}\n`)
  process.exit(1)
}
