import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const psql = process.env.PSQL || 'psql'
const dbUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const logPath = process.env.TASK17A_DIAGNOSTIC_TARGET ? `task17a-postgres-diagnostics-${process.env.TASK17A_DIAGNOSTIC_TARGET.replace(/[^A-Za-z0-9_-]/g, '_')}.log` : 'task17a-postgres-diagnostics.log'

function psqlSync(label, sql) {
  appendFileSync(logPath, `\n## progress/reschedule ${label}\n`)
  const res = spawnSync(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
  return (res.stdout || '').trim()
}

function runSession(name, sql) {
  return new Promise((resolve) => {
    const child = spawn(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', error => resolve({ name, code: 127, out: out.trim(), err: `${err}${error.message}` }))
    child.on('close', code => resolve({ name, code, out: out.trim(), err: err.trim() }))
  })
}

async function runRace(seed, raceName) {
  const setupSql = `
    select task17a_test.reset_fixture(${seed}, 'scheduled_internally', 'scheduled_internally', true)::text;
  `
  const fixture = JSON.parse(psqlSync(`${raceName} fixture`, setupSql).split('\n').at(-1))
  psqlSync(`${raceName} due setup`, `select task17a_test.set_valid_schedule_phase('${fixture.job}'::uuid,'after_operator_due')`)
  psqlSync(`${raceName} claim`, `select public.creator_publishing_claim_onlyfans_operator_task('${fixture.creator}','${fixture.task}','${fixture.job}','${fixture.consent_version}','${fixture.consent_hash}','prsclaim${seed}')`)
  const token = psqlSync(`${raceName} token`, `select claim_token from public.creator_publishing_queue_tasks where id='${fixture.task}'`)
  const baseline = JSON.parse(psqlSync(`${raceName} baseline`, `select jsonb_build_object('revision', schedule_revision, 'intended', intended_publish_at, 'operator_due', operator_due_at)::text from public.creator_publishing_platform_jobs where id='${fixture.job}'`))
  const barrier = psqlSync(`${raceName} database barrier`, `select (clock_timestamp() + interval '2 seconds')::text`)
  const futureIntended = psqlSync(`${raceName} future intended`, `select (clock_timestamp() + interval '4 hours')::text`)
  const progressSql = `set lock_timeout='5s'; set statement_timeout='20s'; select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); select public.creator_publishing_update_onlyfans_operator_progress('${fixture.creator}','${fixture.task}','${fixture.job}','${token}','not_started',0,'preparing','${fixture.consent_version}','${fixture.consent_hash}','prsprog${seed}')::text;`
  const rescheduleSql = `set lock_timeout='5s'; set statement_timeout='20s'; select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); select public.creator_publishing_schedule_plan('${fixture.creator}','${fixture.plan}',$$${futureIntended}$$::timestamptz,'UTC','prsresched${seed}','${fixture.consent_version}','${fixture.consent_hash}',array['${fixture.job}'::uuid],jsonb_build_object('${fixture.job}',${baseline.revision}),'reschedule')::text;`
  const [progress, reschedule] = await Promise.all([
    runSession(`${raceName}-progress`, progressSql),
    runSession(`${raceName}-reschedule`, rescheduleSql)
  ])
  appendFileSync(logPath, `\n## ${raceName} concurrent sessions\n${JSON.stringify({ barrier, progress, reschedule }, null, 2)}\n`)
  const finalState = JSON.parse(psqlSync(`${raceName} final state`, `select jsonb_build_object(
    'queue_status', q.status,
    'claimed_by_null', q.claimed_by is null,
    'claimed_at_null', q.claimed_at is null,
    'claim_token_null', q.claim_token is null,
    'claim_expires_at_null', q.claim_expires_at is null,
    'claim_attempt_count', q.claim_attempt_count,
    'progress_state', q.operator_progress_state,
    'progress_revision', q.operator_progress_revision,
    'assigned_operator_id', q.assigned_operator_id,
    'task18_unchanged', q.posted_by is null and q.posted_at is null and q.posted_confirmation is false and q.final_post_url is null and q.proof_screenshot_storage_key is null and q.skip_or_fail_reason is null,
    'job_state', j.job_state,
    'operator_due_future', j.operator_due_at > clock_timestamp(),
    'schedule_revision', j.schedule_revision,
    'cleanup_audits', (select count(*) from public.creator_publishing_audit_events where entity_id=q.id and action='operator_task_claim_cleared_by_reschedule'),
    'cleanup_has_token', exists(select 1 from public.creator_publishing_audit_events where entity_id=q.id and action='operator_task_claim_cleared_by_reschedule' and (before_state ? 'claim_token' or after_state ? 'claim_token')),
    'progress_audits', (select count(*) from public.creator_publishing_audit_events where entity_id=q.id and action='operator_progress_updated'),
    'reschedule_idempotency_rows', (select count(*) from public.creator_publishing_scheduler_idempotency where creator_id='${fixture.creator}'::uuid and action_type='reschedule' and idempotency_key='prsresched${seed}')
  )::text from public.creator_publishing_queue_tasks q join public.creator_publishing_platform_jobs j on j.content_package_id=q.content_package_id where q.id='${fixture.task}'`))
  const stale = spawnSync(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', `select public.creator_publishing_update_onlyfans_operator_progress('${fixture.creator}','${fixture.task}','${fixture.job}','${token}','not_started',0,'preparing','${fixture.consent_version}','${fixture.consent_hash}','prsstale${seed}')`], { encoding: 'utf8' })
  const staleFailed = stale.status !== 0 && /OPERATOR_CLAIM_TOKEN_MISMATCH/.test(`${stale.stdout}\n${stale.stderr}`)
  const progressWon = progress.code === 0 && finalState.progress_revision === 1 && Number(finalState.progress_audits) === 1
  const rescheduleWon = progress.code !== 0 && /OPERATOR_CLAIM_TOKEN_MISMATCH/.test(`${progress.out}\n${progress.err}`) && finalState.progress_revision === 0 && Number(finalState.progress_audits) === 0
  const ok = reschedule.code === 0 && (progressWon || rescheduleWon) && finalState.queue_status === 'scheduled_internally' && finalState.claimed_by_null && finalState.claimed_at_null && finalState.claim_token_null && finalState.claim_expires_at_null && finalState.job_state === 'scheduled_internally' && finalState.operator_due_future && finalState.schedule_revision === baseline.revision + 1 && Number(finalState.cleanup_audits) === 1 && !finalState.cleanup_has_token && Number(finalState.reschedule_idempotency_rows) === 1 && finalState.task18_unchanged && staleFailed
  if (!ok) {
    console.error(JSON.stringify({ raceName, progress, reschedule, finalState, stale: { status: stale.status, stdout: stale.stdout, stderr: stale.stderr }, deadlock: /deadlock/i.test(`${progress.err}${reschedule.err}`), timeout: /timeout/i.test(`${progress.err}${reschedule.err}`) }, null, 2))
    process.exit(1)
  }
  return { raceName, order: progressWon ? 'progress-wins' : 'reschedule-wins', finalState, staleFailed, deadlock: false, timeout: false }
}

try {
  const probe = spawnSync(psql, ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) { console.error('[task17a-progress-reschedule-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
  psqlSync('load support', `\\i backend/creator-publishing-queue/tests/task17aTestSupport.sql`)
  const races = [await runRace(919001, 'progress-wins-or-reschedule-wins-a'), await runRace(919002, 'progress-wins-or-reschedule-wins-b')]
  console.log(JSON.stringify({ marker: 'TASK17A_PROGRESS_RESCHEDULE_CONCURRENCY_PASSED', synchronization: 'database clock_timestamp barrier', sessions: 2, races }, null, 2))
} catch (error) {
  appendFileSync(logPath, `\nFAILED progress/reschedule concurrency: ${error?.stack || error}\n`)
  throw error
}
