import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const psql = process.env.PSQL || 'psql'
const dbUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const logPath = 'task17a-postgres-diagnostics.log'
function psqlSync(label, args) {
  appendFileSync(logPath, `\n## concurrency ${label}\n`)
  const res = spawnSync(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
  return (res.stdout || '').trim()
}
function runActor(name, actor, key, barrier, task, job, version, hash) {
  return new Promise((resolve) => {
    const sql = `select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); select jsonb_build_object('ok',true,'result', public.creator_publishing_claim_onlyfans_operator_task('${actor}','${task}','${job}','${version}','${hash}','${key}'));`
    const child = spawn(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { stdio: ['ignore','pipe','pipe'] })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', error => resolve({ name, actor, key, code: 127, out: out.trim(), err: `${err}${error.message}` }))
    child.on('close', code => resolve({ name, actor, key, code, out: out.trim(), err: err.trim() }))
  })
}
try {
  const probe = spawnSync(psql, ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) { console.error('[task17a-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
  psqlSync('load support', ['-f', 'backend/creator-publishing-queue/tests/task17aTestSupport.sql'])
  const fixture = JSON.parse(psqlSync('reset fixture', ['-At', '-c', "select task17a_test.reset_fixture(910001)::text"]))
  const barrier = psqlSync('barrier', ['-At', '-c', "select (clock_timestamp() + interval '2 seconds')::text"])
  const results = await Promise.all([
    runActor('actor-a', fixture.operator_a, 'concurrencyA17', barrier, fixture.task, fixture.job, fixture.consent_version, fixture.consent_hash),
    runActor('actor-b', fixture.operator_b, 'concurrencyB17', barrier, fixture.task, fixture.job, fixture.consent_version, fixture.consent_hash)
  ])
  appendFileSync(logPath, `\n## concurrency actors\n${JSON.stringify({ barrier, fixture, results }, null, 2)}\n`)
  const verification = JSON.parse(psqlSync('verification', ['-At', '-c', `select jsonb_build_object(
    'owner', claimed_by,
    'has_token', claim_token is not null,
    'token', claim_token,
    'successful_claim_audits', (select count(*) from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id='${fixture.task}' and idempotency_key in ('concurrencyA17','concurrencyB17')),
    'successful_idempotency_rows', (select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and queue_task_id='${fixture.task}' and idempotency_key in ('concurrencyA17','concurrencyB17'))
  )::text from public.creator_publishing_queue_tasks where id='${fixture.task}';`]))
  const successes = results.filter(r => r.code === 0).map(r => ({ ...r, parsed: JSON.parse(r.out.split('\n').filter(Boolean).at(-1) || '{}') }))
  const losers = results.filter(r => r.code !== 0 && /OPERATOR_TASK_ALREADY_CLAIMED/.test(`${r.err}\n${r.out}`))
  const winnerActor = successes[0]?.actor
  if (successes.length !== 1 || losers.length !== 1 || verification.owner !== winnerActor || verification.has_token !== true || Number(verification.successful_claim_audits) !== 1 || Number(verification.successful_idempotency_rows) !== 1) {
    console.error(JSON.stringify({ barrier, results, verification, deadlock: false }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ synchronization: 'database clock_timestamp barrier', sessions: 2, winner: winnerActor, loser: losers[0].actor, verification, deadlock: false }, null, 2))
} catch (error) {
  appendFileSync(logPath, `\nFAILED concurrency: ${error?.stack || error}\n`)
  throw error
}
