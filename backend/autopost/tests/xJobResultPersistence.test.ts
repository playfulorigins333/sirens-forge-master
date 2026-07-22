import assert from 'node:assert/strict'
import { register } from 'node:module'

process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'
process.env.CRON_SECRET = 'dummy-cron-secret'
process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = 'false'

type Op = { table: string; type: string; values?: any; filters: any[]; select?: string }
type ProofReadbackOverride = Partial<Pick<any, 'rule_id' | 'user_id' | 'platform' | 'scheduled_for' | 'result_status' | 'platform_post_id'>>

class FakeQuery {
  table: string
  type = 'select'
  values: any
  filters: any[] = []
  selectValue?: string
  client: FakeSupabase
  constructor(client: FakeSupabase, table: string) { this.client = client; this.table = table }
  select(value?: string) { this.selectValue = value; return this }
  insert(values: any) { this.type = 'insert'; this.values = values; return this }
  update(values: any) { this.type = 'update'; this.values = values; return this }
  eq(column: string, value: any) { this.filters.push(['eq', column, value]); return this }
  is(column: string, value: any) { this.filters.push(['is', column, value]); return this }
  not(column: string, op: string, value: any) { this.filters.push(['not', column, op, value]); return this }
  lte(column: string, value: any) { this.filters.push(['lte', column, value]); return this }
  or(value: string) { this.filters.push(['or', value]); return this }
  single() { return this }
  maybeSingle() { return this }
  then(resolve: any, reject: any) { return Promise.resolve(this.client.execute(this)).then(resolve, reject) }
}

class FakeSupabase {
  operations: Op[] = []
  rules: any[]
  jobs: any[] = []
  failResultUpdate = false
  failResultLog = false
  proofReadbackOverrides = new Map<string, ProofReadbackOverride>()

  constructor(rules: any[] = []) { this.rules = rules }
  from(table: string) { return new FakeQuery(this, table) }

  execute(q: FakeQuery) {
    this.operations.push({ table: q.table, type: q.type, values: q.values, filters: q.filters, select: q.selectValue })

    if (q.table === 'autopost_rules' && q.type === 'select') return { data: this.rules, error: null }
    if (q.table === 'autopost_rules' && q.type === 'update') {
      const id = filter(q, 'id')
      const rule = this.rules.find((r) => r.id === id)
      if (!rule) return { data: null, error: null }
      Object.assign(rule, q.values)
      return { data: { id }, error: null }
    }
    if (q.table === 'autopost_job_logs' && q.type === 'insert') {
      return { data: null, error: this.failResultLog && ['job_posted_proof_persisted', 'job_result_persisted'].includes(q.values.message) ? { message: 'SECRET_DB_LOG_LEAK' } : null }
    }
    if (q.table === 'autopost_jobs' && q.type === 'insert') {
      const job = { id: `job-${this.jobs.length + 1}`, ...q.values }
      this.jobs.push(job)
      return { data: pickJob(job), error: null }
    }
    if (q.table === 'autopost_jobs' && q.type === 'select') {
      const id = filter(q, 'id')
      const job = id ? this.jobs.find((j) => j.id === id) : this.jobs.find((j) => j.rule_id === filter(q, 'rule_id') && j.platform === filter(q, 'platform') && j.scheduled_for === filter(q, 'scheduled_for'))
      if (!job) return { data: null, error: null }
      if (id && isProofReadbackSelect(q)) return { data: { ...job, ...(this.proofReadbackOverrides.get(id) ?? {}) }, error: null }
      return { data: id ? job : pickJob(job), error: null }
    }
    if (q.table === 'autopost_jobs' && q.type === 'update') {
      const id = filter(q, 'id')
      const job = this.jobs.find((j) => j.id === id)
      if (this.failResultUpdate && 'result_status' in q.values) return { data: null, error: { message: 'SECRET_DB_RESULT_LEAK' } }
      if (!job) return { data: null, error: null }
      Object.assign(job, q.values)
      return { data: pickJob(job), error: null }
    }
    throw new Error(`Unexpected ${q.table}.${q.type}`)
  }
}

function filter(q: FakeQuery, column: string) { return q.filters.find((f) => f[0] === 'eq' && f[1] === column)?.[2] }
function pickJob(job: any) { return { id: job.id, attempt_count: job.attempt_count, locked_at: job.locked_at, lock_id: job.lock_id, state: job.state } }
function op(db: FakeSupabase, table: string, type: string) { return db.operations.filter((o) => o.table === table && o.type === type) }
function logs(db: FakeSupabase, message: string) { return op(db, 'autopost_job_logs', 'insert').filter((o) => o.values.message === message) }
function dueRule(id: string) { return { id, user_id: `user-${id}`, approval_state: 'APPROVED', enabled: true, selected_platforms: ['x'], next_run_at: '2026-07-21T00:00:00.000Z', timezone: 'UTC', start_date: null, end_date: null, posts_per_day: 1, time_slots: ['00:00'], paused_at: null, revoked_at: null, content_payload: { platform: 'x', content_type: 'text', media_posting_enabled: false, text: `local text ${id}` } } }
function authed(url: string) { return new Request(url, { headers: { authorization: 'Bearer dummy-cron-secret' } }) }
function isProofReadbackSelect(q: { selectValue?: string }) { return q.selectValue?.includes('result_status') === true && q.selectValue?.includes('platform_post_id') === true }
function hasEqFilter(op: Op, column: string, value: string) { return op.filters.some((f) => f[0] === 'eq' && f[1] === column && f[2] === value) }
function proofReadbackIndex(db: FakeSupabase, jobId: string) { return db.operations.findIndex((o) => o.table === 'autopost_jobs' && o.type === 'select' && o.select?.includes('result_status') === true && o.select?.includes('platform_post_id') === true && hasEqFilter(o, 'id', jobId)) }
function scheduleUpdateIndex(db: FakeSupabase) { return db.operations.findIndex((o) => o.table === 'autopost_rules' && o.type === 'update') }

const loaderSource = `export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: 'data:text/javascript,export%20{}', shortCircuit: true }; return nextResolve(specifier, context) }`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)
const { executeAutopost } = await import('../../../app/api/autopost/run/route')
const { persistAutopostJobResult } = await import('../../../lib/autopost/jobResults')

const proofOrder = { proofIndex: -1, scheduleIndex: -1 }
const mismatchResults: Record<string, { results_posted: number; schedule_advancements: number; schedule_advancement_skipped: number; autopost_rules_updates: number; skipped_reason: string }> = {}

{
  const db = new FakeSupabase([dueRule('success')])
  const calls: any[] = []
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?execute=1'), {
    supabaseAdmin: db as any,
    cronSecret: 'dummy-cron-secret',
    env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' },
    postXTextOnlyAutopost: async (input: any) => {
      calls.push(input)
      return { ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'durable-local-id', posted_at: '2026-07-21T00:00:00.000Z' }
    },
  })
  const body = await res.json()
  assert.equal(calls.length, 1, 'injected X adapter is used and no real X call occurs')
  assert.equal(body.summary.results_posted, 1)
  assert.equal(body.summary.schedule_advancements, 1)
  assert.equal(db.jobs[0].platform_post_id, 'durable-local-id')
  assert.equal(op(db, 'autopost_jobs', 'select').some((o) => o.select?.includes('result_status') && o.filters.some((f) => f[1] === 'id' && f[2] === 'job-1')), true, 'persisted proof readback exists')
  proofOrder.proofIndex = proofReadbackIndex(db, 'job-1')
  proofOrder.scheduleIndex = scheduleUpdateIndex(db)
  assert.notEqual(proofOrder.proofIndex, -1, 'persisted POSTED-proof readback operation must exist')
  assert.notEqual(proofOrder.scheduleIndex, -1, 'rule schedule advancement update operation must exist')
  assert.ok(proofOrder.proofIndex < proofOrder.scheduleIndex, 'persisted POSTED-proof readback must occur before rule schedule advancement')
  assert.equal(op(db, 'autopost_rules', 'update').length, 1)
  assert.equal(op(db, 'autopost_rules', 'update')[0].filters.some((f) => f[1] === 'id' && f[2] === 'success'), true)
  assert.equal(logs(db, 'schedule_advanced').length, 1)
}

async function runProofMismatchCase(name: string, override: ProofReadbackOverride) {
  const db = new FakeSupabase([dueRule(name)])
  const calls: any[] = []
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?execute=1'), {
    supabaseAdmin: db as any,
    cronSecret: 'dummy-cron-secret',
    env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' },
    postXTextOnlyAutopost: async (input: any) => {
      calls.push(input)
      db.proofReadbackOverrides.set(input.job_id, override)
      return { ok: true, status: 'POSTED', platform: 'x', platform_post_id: `durable-${name}-id`, posted_at: '2026-07-21T00:00:00.000Z', provider_error_message: 'SECRET_PROVIDER_LEAK' }
    },
  })
  const body = await res.json()
  const skipped = logs(db, 'schedule_advancement_skipped')
  assert.equal(calls.length, 1, `${name}: injected adapter must be called exactly once`)
  assert.equal(body.summary.results_posted, 1, `${name}: durable POSTED result must still count as posted before readback gate`)
  assert.equal(body.summary.schedule_advancements, 0, `${name}: schedule advancement must fail closed`)
  assert.equal(body.summary.schedule_advancement_skipped, 1, `${name}: one schedule advancement skip must be counted`)
  assert.equal(op(db, 'autopost_rules', 'update').length, 0, `${name}: no autopost_rules schedule update may occur`)
  assert.equal(skipped.length, 1, `${name}: one schedule_advancement_skipped log must be attempted`)
  assert.equal(skipped[0].values.meta.reason, 'POSTED_PROOF_NOT_PERSISTED_FOR_SLOT', `${name}: skipped reason must be safe and stable`)
  assert.equal(JSON.stringify(body).includes('SECRET_PROVIDER_LEAK'), false, `${name}: raw provider data must not appear in response body`)
  assert.equal(JSON.stringify(body).includes('SECRET_DB'), false, `${name}: raw fake database data must not appear in response body`)
  assert.equal(db.jobs[0].platform_post_id, `durable-${name}-id`, `${name}: readback override must not mutate durable stored job`)
  mismatchResults[name] = {
    results_posted: body.summary.results_posted,
    schedule_advancements: body.summary.schedule_advancements,
    schedule_advancement_skipped: body.summary.schedule_advancement_skipped,
    autopost_rules_updates: op(db, 'autopost_rules', 'update').length,
    skipped_reason: skipped[0].values.meta.reason,
  }
}

await runProofMismatchCase('mismatched-rule-id', { rule_id: 'wrong-rule-id' })
await runProofMismatchCase('mismatched-user-id', { user_id: 'wrong-user-id' })
await runProofMismatchCase('non-x-platform', { platform: 'reddit' })
await runProofMismatchCase('mismatched-scheduled-slot', { scheduled_for: '2026-07-21T01:00:00.000Z' })
await runProofMismatchCase('non-posted-result-status', { result_status: 'FAILED' })
await runProofMismatchCase('empty-platform-post-id', { platform_post_id: '' })

{
  const db = new FakeSupabase()
  db.jobs.push({ id: 'job-direct' })
  db.failResultUpdate = true
  const out = await persistAutopostJobResult(db as any, { job_id: 'job-direct', now: new Date('2026-07-21T00:00:00.000Z'), adapter_result: { ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'local-failed-id', posted_at: '2026-07-21T00:00:00.000Z' } })
  assert.deepEqual({ ok: out.ok, job_result_persisted: out.job_result_persisted, posted: out.posted, platform_post_id: out.platform_post_id, error_code: out.error_code }, { ok: false, job_result_persisted: false, posted: false, platform_post_id: null, error_code: 'JOB_RESULT_PERSIST_FAILED' })
  assert.equal(JSON.stringify(out).includes('SECRET_DB_RESULT_LEAK'), false)
}
{
  const db = new FakeSupabase([dueRule('fail')])
  db.failResultUpdate = true
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?execute=1'), { supabaseAdmin: db as any, cronSecret: 'dummy-cron-secret', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' }, postXTextOnlyAutopost: async () => ({ ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'not-durable', posted_at: '2026-07-21T00:00:00.000Z' }) })
  const body = await res.json()
  assert.equal(body.summary.results_posted, 0)
  assert.equal(body.summary.results_failed, 1)
  assert.equal(body.summary.result_persistence_failures, 1)
  assert.equal(body.summary.schedule_advancements, 0)
  assert.equal(body.summary.schedule_advancement_skipped, 1)
  assert.equal(op(db, 'autopost_jobs', 'select').some((o) => o.select?.includes('result_status')), false, 'no persisted-proof lookup after result update failure')
  assert.equal(op(db, 'autopost_rules', 'update').length, 0, 'no schedule update after result update failure')
  assert.equal(db.jobs[0].platform_post_id, null)
  assert.equal(logs(db, 'schedule_advancement_skipped')[0].values.meta.reason, 'JOB_RESULT_PERSIST_FAILED')
}
{
  const db = new FakeSupabase()
  db.jobs.push({ id: 'job-log' })
  db.failResultLog = true
  const out = await persistAutopostJobResult(db as any, { job_id: 'job-log', now: new Date('2026-07-21T00:00:00.000Z'), adapter_result: { ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'durable-with-log-fail', posted_at: '2026-07-21T00:00:00.000Z' } })
  assert.equal(out.ok, true)
  assert.equal(out.job_result_persisted, true)
  assert.equal(out.audit_log_persisted, false)
  assert.equal(out.audit_log_error_code, 'JOB_LOG_PERSIST_FAILED')
  assert.equal(out.platform_post_id, 'durable-with-log-fail')
  assert.equal(JSON.stringify(out).includes('SECRET_DB_LOG_LEAK'), false)
  assert.equal(op(db, 'autopost_jobs', 'update').length, 1)
}

console.log(`X job result persistence tests passed: proof_readback_index=${proofOrder.proofIndex}; schedule_update_index=${proofOrder.scheduleIndex}; mismatch_results=${JSON.stringify(mismatchResults)}; local fakes only; no X, OAuth, Production, Supabase endpoint, Vercel, SQL, Supabase CLI, live route, adapter route, OnlyFans, Fanvue, Reddit, Generate, or real secret used`)
