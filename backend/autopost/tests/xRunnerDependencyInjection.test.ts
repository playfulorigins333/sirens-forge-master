import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'
process.env.CRON_SECRET = 'dummy-cron-secret'
process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = 'false'

mkdirSync('node_modules/server-only', { recursive: true })
writeFileSync('node_modules/server-only/package.json', JSON.stringify({ name: 'server-only', type: 'module', exports: { '.': { 'react-server': './index.js', default: './index.js' } } }))
writeFileSync('node_modules/server-only/index.js', '')

type Op = { table: string; type: string; values?: any; filters: any[]; select?: string }

type Rule = any
type Job = any

class FakeQuery {
  table: string
  type = 'select'
  values: any
  filters: any[] = []
  selectValue?: string
  client: FakeSupabase
  singleMode: 'single' | 'maybeSingle' | null = null
  constructor(client: FakeSupabase, table: string) { this.client = client; this.table = table }
  select(value?: string) { this.selectValue = value; this.type ||= 'select'; return this }
  insert(values: any) { this.type = 'insert'; this.values = values; return this }
  update(values: any) { this.type = 'update'; this.values = values; return this }
  eq(column: string, value: any) { this.filters.push(['eq', column, value]); return this }
  is(column: string, value: any) { this.filters.push(['is', column, value]); return this }
  not(column: string, op: string, value: any) { this.filters.push(['not', column, op, value]); return this }
  lte(column: string, value: any) { this.filters.push(['lte', column, value]); return this }
  or(value: string) { this.filters.push(['or', value]); return this }
  single() { this.singleMode = 'single'; return this }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this }
  then(resolve: any, reject: any) { return Promise.resolve(this.client.execute(this)).then(resolve, reject) }
}

class FakeSupabase {
  operations: Op[] = []
  rules: Rule[]
  jobs: Job[] = []
  duplicateOnceForRuleIds = new Set<string>()
  blockLocks = new Set<string>()
  failResultUpdate = false
  constructor(rules: Rule[]) { this.rules = rules }
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
    if (q.table === 'autopost_job_logs' && q.type === 'insert') return { data: null, error: null }
    if (q.table === 'autopost_jobs' && q.type === 'insert') {
      if (this.duplicateOnceForRuleIds.delete(q.values.rule_id)) return { data: null, error: { code: '23505', message: 'duplicate' } }
      const job = { id: `job-${this.jobs.length + 1}`, ...q.values }
      this.jobs.push(job)
      return { data: pickJob(job), error: null }
    }
    if (q.table === 'autopost_jobs' && q.type === 'select') {
      const id = filter(q, 'id')
      const job = id ? this.jobs.find((j) => j.id === id) : this.jobs.find((j) => j.rule_id === filter(q, 'rule_id') && j.platform === filter(q, 'platform') && j.scheduled_for === filter(q, 'scheduled_for'))
      return { data: job ? (id ? job : pickJob(job)) : null, error: null }
    }
    if (q.table === 'autopost_jobs' && q.type === 'update') {
      const id = filter(q, 'id')
      const job = this.jobs.find((j) => j.id === id)
      if (!job || this.blockLocks.has(id)) return { data: null, error: null }
      if (this.failResultUpdate && 'result_status' in q.values) return { data: null, error: { message: 'local result persistence failure' } }
      Object.assign(job, q.values)
      return { data: pickJob(job), error: null }
    }
    throw new Error(`Unexpected fake operation ${q.table}.${q.type}`)
  }
}

function filter(q: FakeQuery, column: string) { return q.filters.find((f) => f[0] === 'eq' && f[1] === column)?.[2] }
function pickJob(job: Job) { return { id: job.id, attempt_count: job.attempt_count, locked_at: job.locked_at, lock_id: job.lock_id, state: job.state } }
function op(db: FakeSupabase, table: string, type: string) { return db.operations.filter((o) => o.table === table && o.type === type) }
function logs(db: FakeSupabase, message: string) { return op(db, 'autopost_job_logs', 'insert').filter((o) => o.values.message === message) }
function dueRule(id: string, next = '2026-07-21T00:00:00.000Z') {
  return { id, user_id: `user-${id}`, approval_state: 'APPROVED', enabled: true, selected_platforms: ['x'], next_run_at: next, timezone: 'UTC', start_date: null, end_date: null, posts_per_day: 1, time_slots: ['00:00'], paused_at: null, revoked_at: null, content_payload: { platform: 'x', content_type: 'text', media_posting_enabled: false, text: `local text ${id}` } }
}
function authed(url: string) { return new Request(url, { headers: { authorization: 'Bearer dummy-cron-secret' } }) }

const { executeAutopost } = await import('../../../app/api/autopost/run/route')

{
  const db = new FakeSupabase([dueRule('success')])
  const adapterCalls: any[] = []
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?execute=1'), {
    supabaseAdmin: db as any,
    cronSecret: 'dummy-cron-secret',
    env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' },
    postXTextOnlyAutopost: async (input: any) => {
      adapterCalls.push(input)
      return { ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'local-fake-x-post-id', posted_at: '2026-07-21T00:00:00.000Z' }
    },
  })
  const body = await res.json()
  assert.equal(adapterCalls.length, 1)
  assert.deepEqual(adapterCalls[0], { run_mode: 'autopost', user_id: 'user-success', rule_id: 'success', job_id: 'job-1', payload: { text: 'local text success' } })
  assert.equal(body.summary.results_posted, 1)
  assert.equal(body.summary.schedule_advancements, 1)
  assert.equal(op(db, 'autopost_rules', 'select').length, 1, 'due-rule selection uses injected db')
  assert.equal(op(db, 'autopost_jobs', 'insert').length, 1, 'pending-job insertion uses injected db')
  assert.equal(logs(db, 'job_created').length, 1, 'successful creation logging uses injected db')
  assert.equal(op(db, 'autopost_jobs', 'update').some((o) => o.values.lock_id), true, 'job locking uses injected db')
  assert.equal(logs(db, 'job_locked').length, 1, 'lock-success logging uses injected db')
  assert.equal(op(db, 'autopost_jobs', 'update').some((o) => o.values.result_status === 'POSTED'), true, 'result-persistence job update uses injected db')
  assert.equal(logs(db, 'job_posted_proof_persisted').length, 1, 'result-persistence status logging uses injected db')
  assert.equal(logs(db, 'job_result_persisted').length, 1, 'result-persistence completion logging uses injected db')
  assert.equal(op(db, 'autopost_jobs', 'select').some((o) => o.filters.some((f) => f[1] === 'id' && f[2] === 'job-1')), true, 'persisted POSTED-proof lookup uses injected db')
  assert.equal(op(db, 'autopost_rules', 'update').length, 1, 'rule schedule update uses injected db')
  assert.equal(logs(db, 'schedule_advanced').length, 1, 'schedule-advanced logging uses injected db')
}

{
  const db = new FakeSupabase([dueRule('dup')])
  db.jobs.push({ id: 'existing-job', rule_id: 'dup', user_id: 'user-dup', platform: 'x', scheduled_for: '2026-07-21T00:00:00.000Z', state: 'QUEUED', result_status: 'PENDING', attempt_count: 0, locked_at: null, lock_id: null })
  db.duplicateOnceForRuleIds.add('dup')
  db.blockLocks.add('existing-job')
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?foundation=1&claim=1'), { supabaseAdmin: db as any, cronSecret: 'dummy-cron-secret', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'false' } })
  const body = await res.json()
  assert.equal(body.summary.jobs_existing, 1)
  assert.equal(body.summary.job_lock_skipped, 1)
  assert.equal(op(db, 'autopost_jobs', 'insert')[0].values.rule_id, 'dup', 'duplicate insertion stays on injected db')
  assert.equal(op(db, 'autopost_jobs', 'select').some((o) => o.filters.some((f) => f[1] === 'rule_id' && f[2] === 'dup')), true, 'duplicate-error recovery existing-job lookup uses injected db')
  assert.equal(logs(db, 'job_dedupe_skipped').length, 1, 'job deduplication logging uses injected db')
  assert.equal(logs(db, 'job_lock_skipped').length, 1, 'lock-skipped logging uses injected db')
}

{
  const db = new FakeSupabase([dueRule('disabled')])
  let adapterCalls = 0
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?dispatch=1&foundation=1'), { supabaseAdmin: db as any, cronSecret: 'dummy-cron-secret', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'false' }, postXTextOnlyAutopost: async () => { adapterCalls++; throw new Error('must not call adapter') } })
  const body = await res.json()
  assert.equal(adapterCalls, 0)
  assert.equal(body.dispatch_enabled, false)
  assert.equal(body.summary.dispatches_attempted, 0)
  assert.equal(op(db, 'autopost_jobs', 'update').some((o) => 'result_status' in o.values), false, 'no result persistence is attempted')
  assert.equal(op(db, 'autopost_rules', 'update').length, 0, 'no schedule advancement is attempted')
  assert.equal(logs(db, 'schedule_advanced').length + logs(db, 'schedule_advancement_skipped').length, 0, 'no schedule logging is attempted')
}

{
  const db = new FakeSupabase([dueRule('skip')])
  db.failResultUpdate = true
  const res = await executeAutopost(authed('http://local.test/api/autopost/run?execute=1'), { supabaseAdmin: db as any, cronSecret: 'dummy-cron-secret', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' }, postXTextOnlyAutopost: async () => ({ ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'local-skip-id', posted_at: '2026-07-21T00:00:00.000Z' }) })
  const body = await res.json()
  assert.equal(body.summary.schedule_advancement_skipped, 1)
  assert.equal(logs(db, 'schedule_advancement_skipped').length, 1, 'schedule-skipped logging uses injected db when proof is not persisted')
}

const routeSource = readFileSync('app/api/autopost/run/route.ts', 'utf8')
assert.match(routeSource, /const supabaseAdmin = createClient\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\)/)
assert.match(routeSource, /const db = deps\.supabaseAdmin \?\? supabaseAdmin/)
assert.match(routeSource, /const postX = deps\.postXTextOnlyAutopost \?\? postXTextOnlyAutopost/)
assert.match(routeSource, /export async function GET\(req: Request\) \{\s*return executeAutopost\(req\);\s*\}/)
assert.match(routeSource, /export async function POST\(req: Request\) \{\s*return executeAutopost\(req\);\s*\}/)
assert.doesNotMatch(routeSource, /supabaseAdmin\.from\(/)
assert.doesNotMatch(routeSource, /persistAutopostJobResult\(supabaseAdmin/)
assert.doesNotMatch(routeSource, /fetch\(|api\.x\.com|oauth|supabase\.co/i)

rmSync('node_modules/server-only', { recursive: true, force: true })
console.log('X runner dependency-injection tests passed')
