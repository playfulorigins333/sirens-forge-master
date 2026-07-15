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

function parseLastJson(text) {
  const line = (text || '').split('\n').filter(Boolean).at(-1) || '{}'
  return JSON.parse(line)
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

function sameField(a, b, field) {
  return (a[field] ?? null) === (b[field] ?? null)
}

async function runRace(seed, raceName, expectedOrder, scheduleAction = 'reschedule') {
  const isInitialSchedule = scheduleAction === 'schedule'
  const fixture = parseLastJson(psqlSync(`${raceName} fixture`, isInitialSchedule ? `select task17a_test.reset_fixture(${seed}, 'ready_for_handoff', 'draft', false)::text` : `select task17a_test.reset_fixture(${seed}, 'scheduled_internally', 'scheduled_internally', true)::text`))
  if (!isInitialSchedule) psqlSync(`${raceName} due setup`, `select task17a_test.set_valid_schedule_phase('${fixture.job}'::uuid,'after_operator_due')`)
  psqlSync(`${raceName} claim`, `select public.creator_publishing_claim_onlyfans_operator_task('${fixture.creator}','${fixture.task}','${fixture.job}','${fixture.consent_version}','${fixture.consent_hash}','prsclaim${seed}')`)
  const token = psqlSync(`${raceName} token`, `select claim_token from public.creator_publishing_queue_tasks where id='${fixture.task}'`)
  const queueBaseline = parseLastJson(psqlSync(`${raceName} queue baseline`, `select jsonb_build_object(
    'claim_attempt_count', claim_attempt_count,
    'operator_progress_state', operator_progress_state,
    'operator_progress_revision', operator_progress_revision,
    'operator_progress_updated_by', operator_progress_updated_by,
    'operator_progress_updated_at', operator_progress_updated_at,
    'assigned_operator_id', assigned_operator_id,
    'posted_by', posted_by,
    'posted_at', posted_at,
    'posted_confirmation', posted_confirmation,
    'final_post_url', final_post_url,
    'final_post_url_skip_reason', final_post_url_skip_reason,
    'proof_screenshot_storage_key', proof_screenshot_storage_key,
    'skip_or_fail_reason', skip_or_fail_reason
  )::text from public.creator_publishing_queue_tasks where id='${fixture.task}'`))
  const jobBaseline = parseLastJson(psqlSync(`${raceName} job baseline`, `select jsonb_build_object('revision', schedule_revision, 'intended', intended_publish_at, 'operator_due', operator_due_at, 'job_state', job_state)::text from public.creator_publishing_platform_jobs where id='${fixture.job}'`))
  const barrier = psqlSync(`${raceName} database barrier`, `select (clock_timestamp() + interval '2 seconds')::text`)
  const futureIntended = psqlSync(`${raceName} future intended`, `select (clock_timestamp() + interval '4 hours')::text`)
  const progressDelay = expectedOrder === 'reschedule-wins' ? 'select pg_sleep(0.5);' : ''
  const rescheduleDelay = expectedOrder === 'progress-wins' ? 'select pg_sleep(0.5);' : ''
  const progressSql = `set lock_timeout='5s'; set statement_timeout='20s'; select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); ${progressDelay} select public.creator_publishing_update_onlyfans_operator_progress('${fixture.creator}','${fixture.task}','${fixture.job}','${token}','not_started',0,'preparing','${fixture.consent_version}','${fixture.consent_hash}','prsprog${seed}')::text;`
  const scheduleKey = `${isInitialSchedule ? 'prssched' : 'prsresched'}${seed}`
  const expectedRevisions = isInitialSchedule ? `'{}'::jsonb` : `jsonb_build_object('${fixture.job}',${jobBaseline.revision})`
  const rescheduleSql = `set lock_timeout='5s'; set statement_timeout='20s'; select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); ${rescheduleDelay} select public.creator_publishing_schedule_plan('${fixture.creator}','${fixture.plan}',$$${futureIntended}$$::timestamptz,'UTC','${scheduleKey}','${fixture.consent_version}','${fixture.consent_hash}',array['${fixture.job}'::uuid],${expectedRevisions},'${scheduleAction}')::text;`
  const [progress, reschedule] = await Promise.all([
    runSession(`${raceName}-progress`, progressSql),
    runSession(`${raceName}-reschedule`, rescheduleSql)
  ])
  appendFileSync(logPath, `\n## ${raceName} concurrent sessions\n${JSON.stringify({ expectedOrder, barrier, progress, reschedule }, null, 2)}\n`)
  const progressResult = progress.code === 0 ? parseLastJson(progress.out) : null
  const rescheduleResult = reschedule.code === 0 ? parseLastJson(reschedule.out) : null
  const cleanupAction = isInitialSchedule ? 'operator_task_claim_cleared_by_schedule' : 'operator_task_claim_cleared_by_reschedule'
  const cleanupReason = isInitialSchedule ? 'scheduled_before_operator_due' : 'rescheduled_before_operator_due'
  const finalState = parseLastJson(psqlSync(`${raceName} final state`, `select jsonb_build_object(
    'queue_status', q.status,
    'claimed_by_null', q.claimed_by is null,
    'claimed_at_null', q.claimed_at is null,
    'claim_token_null', q.claim_token is null,
    'claim_expires_at_null', q.claim_expires_at is null,
    'claim_attempt_count', q.claim_attempt_count,
    'operator_progress_state', q.operator_progress_state,
    'operator_progress_revision', q.operator_progress_revision,
    'operator_progress_updated_by', q.operator_progress_updated_by,
    'operator_progress_updated_at', q.operator_progress_updated_at,
    'assigned_operator_id', q.assigned_operator_id,
    'posted_by', q.posted_by,
    'posted_at', q.posted_at,
    'posted_confirmation', q.posted_confirmation,
    'final_post_url', q.final_post_url,
    'final_post_url_skip_reason', q.final_post_url_skip_reason,
    'proof_screenshot_storage_key', q.proof_screenshot_storage_key,
    'skip_or_fail_reason', q.skip_or_fail_reason,
    'job_state', j.job_state,
    'operator_due_future', j.operator_due_at > clock_timestamp(),
    'operator_due_exact_offset', j.operator_due_at = j.intended_publish_at - interval '60 minutes',
    'schedule_revision', j.schedule_revision,
    'cleanup_audits', (select count(*) from public.creator_publishing_audit_events where entity_id=q.id and action='${cleanupAction}'),
    'cleanup_has_token', exists(select 1 from public.creator_publishing_audit_events where entity_id=q.id and action='${cleanupAction}' and (before_state ? 'claim_token' or after_state ? 'claim_token')),
    'progress_audits', (select count(*) from public.creator_publishing_audit_events where entity_id=q.id and action='operator_preparation_started' and idempotency_key='prsprog${seed}'),
    'progress_idempotency_rows', (select count(*) from public.creator_publishing_operator_action_idempotency where queue_task_id=q.id and platform_job_id=j.id and action_type='progress_update' and idempotency_key='prsprog${seed}'),
    'reschedule_idempotency_rows', (select count(*) from public.creator_publishing_scheduler_idempotency where creator_id='${fixture.creator}'::uuid and action_type='${scheduleAction}' and idempotency_key='${scheduleKey}')
  )::text from public.creator_publishing_queue_tasks q join public.creator_publishing_platform_jobs j on j.content_package_id=q.content_package_id where q.id='${fixture.task}' and j.id='${fixture.job}'`))
  const beforeStaleQueue = psqlSync(`${raceName} before stale queue`, `select to_jsonb(q)::text from public.creator_publishing_queue_tasks q where id='${fixture.task}'`)
  const beforeStaleJob = psqlSync(`${raceName} before stale job`, `select to_jsonb(j)::text from public.creator_publishing_platform_jobs j where id='${fixture.job}'`)
  const stale = spawnSync(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', `select public.creator_publishing_update_onlyfans_operator_progress('${fixture.creator}','${fixture.task}','${fixture.job}','${token}','not_started',0,'preparing','${fixture.consent_version}','${fixture.consent_hash}','prsstale${seed}')`], { encoding: 'utf8' })
  const afterStaleQueue = psqlSync(`${raceName} after stale queue`, `select to_jsonb(q)::text from public.creator_publishing_queue_tasks q where id='${fixture.task}'`)
  const afterStaleJob = psqlSync(`${raceName} after stale job`, `select to_jsonb(j)::text from public.creator_publishing_platform_jobs j where id='${fixture.job}'`)
  const staleState = parseLastJson(psqlSync(`${raceName} stale audit idempotency`, `select jsonb_build_object(
    'audit_rows', (select count(*) from public.creator_publishing_audit_events where entity_id='${fixture.task}'::uuid and action='operator_preparation_started' and idempotency_key='prsstale${seed}'),
    'idempotency_rows', (select count(*) from public.creator_publishing_operator_action_idempotency where queue_task_id='${fixture.task}'::uuid and platform_job_id='${fixture.job}'::uuid and action_type='progress_update' and idempotency_key='prsstale${seed}')
  )::text`))
  const staleFailed = stale.status !== 0 && /OPERATOR_CLAIM_TOKEN_MISMATCH/.test(`${stale.stdout}\n${stale.stderr}`)
  const rescheduleCleanup = rescheduleResult?.jobs?.[0]?.operator_claim_cleanup
  const rescheduleOk = reschedule.code === 0 && rescheduleResult?.ok === true && rescheduleResult?.action_type === scheduleAction && rescheduleResult?.success_count === 1 && rescheduleResult?.failure_count === 0 && rescheduleResult?.jobs?.[0]?.job_id === fixture.job && rescheduleCleanup?.performed === true && rescheduleCleanup?.queue_task_id === fixture.task && rescheduleCleanup?.previous_status === 'claimed' && rescheduleCleanup?.resulting_status === 'scheduled_internally' && rescheduleCleanup?.reason === cleanupReason && !JSON.stringify(rescheduleResult).includes('claim_token')
  const progressSuccessOk = progress.code === 0 && progressResult?.ok === true && progressResult?.action === 'progress_update' && progressResult?.queue_task_id === fixture.task && progressResult?.platform_job_id === fixture.job && progressResult?.progress_state === 'preparing' && progressResult?.progress_revision === queueBaseline.operator_progress_revision + 1
  const progressWon = progressSuccessOk && finalState.operator_progress_state === 'preparing' && finalState.operator_progress_revision === queueBaseline.operator_progress_revision + 1 && finalState.operator_progress_updated_by === fixture.creator && finalState.operator_progress_updated_at !== null && (queueBaseline.operator_progress_updated_at === null || finalState.operator_progress_updated_at >= queueBaseline.operator_progress_updated_at) && Number(finalState.progress_audits) === 1 && Number(finalState.progress_idempotency_rows) === 1
  const rescheduleWon = progress.code !== 0 && /OPERATOR_CLAIM_TOKEN_MISMATCH/.test(`${progress.out}\n${progress.err}`) && finalState.operator_progress_state === queueBaseline.operator_progress_state && finalState.operator_progress_revision === queueBaseline.operator_progress_revision && sameField(finalState, queueBaseline, 'operator_progress_updated_by') && sameField(finalState, queueBaseline, 'operator_progress_updated_at') && Number(finalState.progress_audits) === 0 && Number(finalState.progress_idempotency_rows) === 0
  const observedOrder = progressWon ? 'progress-wins' : (rescheduleWon ? 'reschedule-wins' : 'invalid')
  const expectedOrderOk = expectedOrder === 'either' ? observedOrder !== 'invalid' : observedOrder === expectedOrder
  const task18Fields = ['posted_by', 'posted_at', 'posted_confirmation', 'final_post_url', 'final_post_url_skip_reason', 'proof_screenshot_storage_key', 'skip_or_fail_reason']
  const task18Unchanged = task18Fields.every(field => sameField(finalState, queueBaseline, field))
  const commonOk = rescheduleOk && expectedOrderOk && finalState.queue_status === 'scheduled_internally' && finalState.claimed_by_null && finalState.claimed_at_null && finalState.claim_token_null && finalState.claim_expires_at_null && finalState.job_state === 'scheduled_internally' && finalState.operator_due_future && finalState.operator_due_exact_offset && finalState.schedule_revision === (isInitialSchedule ? 1 : jobBaseline.revision + 1) && finalState.claim_attempt_count === queueBaseline.claim_attempt_count && sameField(finalState, queueBaseline, 'assigned_operator_id') && task18Unchanged && Number(finalState.cleanup_audits) === 1 && !finalState.cleanup_has_token && Number(finalState.reschedule_idempotency_rows) === 1 && staleFailed && beforeStaleQueue === afterStaleQueue && beforeStaleJob === afterStaleJob && Number(staleState.audit_rows) === 0 && Number(staleState.idempotency_rows) === 0
  if (!commonOk) {
    console.error(JSON.stringify({ raceName, expectedOrder, observedOrder, progress, reschedule, progressResult, rescheduleResult, queueBaseline, jobBaseline, finalState, stale: { status: stale.status, stdout: stale.stdout, stderr: stale.stderr }, staleState, beforeStaleQueue, afterStaleQueue, beforeStaleJob, afterStaleJob, deadlock: /deadlock/i.test(`${progress.err}${reschedule.err}`), timeout: /timeout/i.test(`${progress.err}${reschedule.err}`) }, null, 2))
    process.exit(1)
  }
  return { raceName, expectedOrder, scheduleAction, observedOrder, finalState, progressResult, rescheduleCleanup, staleFailed, staleState, deadlock: false, timeout: false }
}

try {
  const probe = spawnSync(psql, ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) { console.error('[task17a-progress-reschedule-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
  psqlSync('load support', `\\i backend/creator-publishing-queue/tests/task17aTestSupport.sql`)
  const races = [
    await runRace(919001, 'progress_first_then_reschedule', 'progress-wins'),
    await runRace(919002, 'reschedule_first_then_progress', 'reschedule-wins'),
    await runRace(919003, 'simultaneous_progress_reschedule', 'either'),
    await runRace(919004, 'simultaneous_progress_initial_schedule', 'either', 'schedule')
  ]
  if (!races.some(r => r.observedOrder === 'progress-wins') || !races.some(r => r.observedOrder === 'reschedule-wins')) process.exit(1)
  console.log(JSON.stringify({ marker: 'TASK17A_PROGRESS_RESCHEDULE_CONCURRENCY_PASSED', synchronization: 'database clock_timestamp barrier', sessions: 2, races }, null, 2))
} catch (error) {
  appendFileSync(logPath, `\nFAILED progress/reschedule concurrency: ${error?.stack || error}\n`)
  throw error
}
