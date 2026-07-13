import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'

const psql = process.env.PSQL || 'psql'
const dbUrl = process.env.TASK17A_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const logPath = 'task17a-postgres-diagnostics.log'
function psqlSync(label, sql) {
  appendFileSync(logPath, `\n## concurrency ${label}\n`)
  const res = spawnSync(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  appendFileSync(logPath, res.stdout || '')
  appendFileSync(logPath, res.stderr || '')
  if (res.error) appendFileSync(logPath, `spawn_error=${res.error.message}\n`)
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`)
  return res.stdout
}
function runActor(name, actor, key, barrier) {
  return new Promise((resolve) => {
    const sql = `select clock_timestamp() as ready_${name}; select pg_sleep(greatest(0, extract(epoch from ($$${barrier}$$::timestamptz - clock_timestamp())))); select public.creator_publishing_claim_onlyfans_operator_task('${actor}','60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','${key}') as claim_result;`
    const child = spawn(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore','pipe','pipe'] })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', error => resolve({ name, code: 127, out, err: `${err}${error.message}` }))
    child.on('close', code => resolve({ name, code, out, err }))
  })
}
try {
  const probe = spawnSync(psql, ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) { console.error('[task17a-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127) }
  const barrier = new Date(Date.now() + 2500).toISOString()
  const actorA = '00000000-0000-4000-8000-000000000001'
  const actorB = '00000000-0000-4000-8000-000000000002'
  const results = await Promise.all([
    runActor('actor-a', actorA, 'concurrencyA17', barrier),
    runActor('actor-b', actorB, 'concurrencyB17', barrier)
  ])
  appendFileSync(logPath, `\n## concurrency actors\n${JSON.stringify({ barrier, results }, null, 2)}\n`)
  const verification = psqlSync('verification', `select jsonb_build_object(
    'owner', claimed_by,
    'has_token', claim_token is not null,
    'successful_claim_audits', (select count(*) from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id='60000000-0000-4000-8000-000000000001'),
    'successful_idempotency_rows', (select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and queue_task_id='60000000-0000-4000-8000-000000000001')
  ) as concurrency_verification from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000001';`)
  const successCount = results.filter(r => r.code === 0).length
  const safeClaimLosers = results.filter(r => r.code !== 0 && /OPERATOR_TASK_ALREADY_CLAIMED/.test(r.err + r.out)).length
  if (successCount !== 1 || safeClaimLosers !== 1 || !/successful_claim_audits.*1/s.test(verification) || !/successful_idempotency_rows.*1/s.test(verification)) {
    console.error(JSON.stringify({ barrier, results, verification, deadlock: false }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ synchronization: 'future database timestamp pg_sleep barrier', sessions: 2, verification, deadlock: false }, null, 2))
} catch (error) {
  appendFileSync(logPath, `\nFAILED concurrency: ${error?.stack || error}\n`)
  throw error
}
