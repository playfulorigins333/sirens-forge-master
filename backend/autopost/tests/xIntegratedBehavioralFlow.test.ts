import assert from 'node:assert/strict'
import { register } from 'node:module'

const ENV_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
] as const
const originalEnv = new Map<(typeof ENV_KEYS)[number], string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'
process.env.CRON_SECRET = 'dummy-cron-secret'

const loaderSource = `export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: 'data:text/javascript,export%20{}', shortCircuit: true }; return nextResolve(specifier, context) }`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const { executeAutopost } = await import('../../../app/api/autopost/run/route')
const { postXTextOnlyAutopost } = await import('../../../lib/autopost/xAdapter')
const { refreshXAccessToken } = await import('../../../lib/autopost/xTokenRefresh')
const { getAutopostPlatformRegistry, getSelectableAutopostPlatformIds } = await import('../../../lib/autopost/platformRegistry')
const { buildUserPlatformStatus } = await import('../../../lib/autopost/platformAvailability')

type DbEvent = {
  type: 'db'
  table: string
  operation: string
  values?: unknown
  select?: string
  filters?: unknown
  single: boolean
  maybeSingle: boolean
}
type FetchEvent = { type: 'fetch'; endpoint: 'refresh' | 'create_post'; url: string }
type Event = DbEvent | FetchEvent

type Operation = {
  table: string
  type: string
  values?: any
  filters: any[]
  select?: string
  single: boolean
  maybeSingle: boolean
}

type Rule = ReturnType<typeof makeRule>
type Job = Record<string, any>
type Account = ReturnType<typeof makeAccount>

const API = 'https://api.x.invalid'
const TWEETS_ENDPOINT = `${API}/2/tweets`
const TOKEN_ENDPOINT = `${API}/2/oauth2/token`

const OLD_ENCRYPTED_ACCESS = 'enc-local-access-old'
const OLD_ENCRYPTED_REFRESH = 'enc-local-refresh-old'
const NEW_ENCRYPTED_ACCESS = 'enc-local-access-new'
const NEW_ENCRYPTED_REFRESH = 'enc-local-refresh-new'
const OLD_ACCESS = 'plain-local-access-old'
const NEW_ACCESS = 'plain-local-access-new'
const OLD_REFRESH = 'plain-local-refresh-old'
const NEW_REFRESH = 'plain-local-refresh-new'
const CLIENT_ID = 'local-test-client'
const CLIENT_SECRET = 'local-test-client-secret'
const RAW_PROVIDER_BODY = 'RAW_PROVIDER_BODY_MARKER'
const THROW_POST = 'THROWN_CREATE_POST_EXCEPTION_MARKER'
const THROW_REFRESH = 'THROWN_REFRESH_EXCEPTION_MARKER'
const RAW_DB = 'RAW_FAKE_DATABASE_ERROR_MARKER'
const CURRENT_ISO = '2026-07-23T12:00:00.000Z'
const RETRY_ISO = '2026-07-23T12:05:00.000Z'
const NEXT_RUN_ISO = '2026-07-24T12:00:00.000Z'
const ALLOWED_LOG_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])
const FORBIDDEN_MARKERS = [
  OLD_ENCRYPTED_ACCESS,
  OLD_ENCRYPTED_REFRESH,
  NEW_ENCRYPTED_ACCESS,
  NEW_ENCRYPTED_REFRESH,
  OLD_ACCESS,
  NEW_ACCESS,
  OLD_REFRESH,
  NEW_REFRESH,
  CLIENT_SECRET,
  RAW_PROVIDER_BODY,
  THROW_POST,
  THROW_REFRESH,
  RAW_DB,
]

let currentNow = new Date(CURRENT_ISO)
const now = () => new Date(currentNow)

const allowedUpdateColumns: Record<string, Set<string>> = {
  autopost_jobs: new Set([
    'state',
    'result_status',
    'result',
    'error_code',
    'error_message',
    'platform_post_id',
    'posted_at',
    'completed_at',
    'next_attempt_at',
    'locked_at',
    'lock_id',
    'attempt_count',
  ]),
  autopost_accounts: new Set([
    'encrypted_access_token',
    'encrypted_refresh_token',
    'token_key_version',
    'token_expires_at',
    'token_type',
    'connection_status',
    'last_refresh_at',
    'last_error',
    'scopes',
  ]),
  autopost_rules: new Set(['last_run_at', 'next_run_at']),
}

class FakeResponse {
  status: number
  ok: boolean
  private body: unknown

  constructor(status: number, body: unknown) {
    this.status = status
    this.ok = status >= 200 && status < 300
    this.body = body
  }

  async json() {
    return this.body
  }
}

class FakeFetch {
  private readonly events: Event[]
  private readonly queue: Array<{ status: number; body: unknown } | { throw: Error }> = []
  calls: Array<{
    url: string
    method: string
    authorization: string | null
    contentType: string | null
    body: any
  }> = []

  constructor(events: Event[]) {
    this.events = events
  }

  enqueue(status: number, body: unknown) {
    this.queue.push({ status, body })
  }

  throwNext(error: Error) {
    this.queue.push({ throw: error })
  }

  impl = async (url: unknown, init: RequestInit = {}) => {
    const href = String(url)
    const endpoint = href === TOKEN_ENDPOINT ? 'refresh' : href === TWEETS_ENDPOINT ? 'create_post' : null
    if (!endpoint) throw new Error(`unexpected fake URL ${href}`)

    const method = String(init.method || 'GET').toUpperCase()
    if (method !== 'POST') throw new Error('unexpected fake method')

    const headers = new Headers(init.headers || {})
    const call = {
      url: href,
      method,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      body: init.body,
    }
    this.calls.push(call)
    this.events.push({ type: 'fetch', endpoint, url: href })

    const next = this.queue.shift()
    if (!next) throw new Error('missing queued fake fetch response')
    if ('throw' in next) throw next.throw
    return new FakeResponse(next.status, next.body) as Response
  }

  createPostCalls() {
    return this.calls.filter((call) => call.url === TWEETS_ENDPOINT)
  }

  refreshCalls() {
    return this.calls.filter((call) => call.url === TOKEN_ENDPOINT)
  }
}

class FakeQuery {
  table: string
  type = 'select'
  values: any
  filters: any[] = []
  selectValue?: string
  singleCalled = false
  maybeSingleCalled = false
  private readonly client: FakeSupabase

  constructor(client: FakeSupabase, table: string) {
    this.client = client
    this.table = table
  }

  select(value?: string) {
    this.selectValue = value
    return this
  }

  insert(values: any) {
    this.type = 'insert'
    this.values = values
    return this
  }

  update(values: any) {
    this.type = 'update'
    this.values = values
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push(['eq', column, value])
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push(['is', column, value])
    return this
  }

  not(column: string, op: string, value: unknown) {
    this.filters.push(['not', column, op, value])
    return this
  }

  lte(column: string, value: unknown) {
    this.filters.push(['lte', column, value])
    return this
  }

  or(value: string) {
    this.filters.push(['or', value])
    return this
  }

  single() {
    this.singleCalled = true
    return this
  }

  maybeSingle() {
    this.maybeSingleCalled = true
    return this
  }

  then(resolve: any, reject: any) {
    return Promise.resolve(this.client.execute(this)).then(resolve, reject)
  }
}

class FakeSupabase {
  readonly events: Event[]
  operations: Operation[] = []
  rules: Rule[] = []
  jobs: Job[] = []
  logs: any[] = []
  accounts: Account[] = []
  scheduleUpdates = 0
  resultUpdates = 0
  failJobLogs: 'none' | 'return-error' | 'throw-error' = 'none'

  constructor(events: Event[], id = 'fixture', expired = false) {
    this.events = events
    this.rules = [makeRule(id)]
    this.accounts = [makeAccount(`user-${id}`, expired)]
  }

  from(table: string) {
    return new FakeQuery(this, table)
  }

  execute(query: FakeQuery): any {
    const operation: Operation = {
      table: query.table,
      type: query.type,
      values: query.values,
      filters: query.filters,
      select: query.selectValue,
      single: query.singleCalled,
      maybeSingle: query.maybeSingleCalled,
    }
    this.operations.push(operation)
    this.events.push({
      type: 'db',
      table: query.table,
      operation: query.type,
      values: query.values,
      select: query.selectValue,
      filters: query.filters,
      single: query.singleCalled,
      maybeSingle: query.maybeSingleCalled,
    })

    if (query.type === 'update' && allowedUpdateColumns[query.table]) {
      const unknown = Object.keys(query.values).filter((column) => !allowedUpdateColumns[query.table].has(column))
      if (unknown.length > 0) return { data: null, error: { message: `${RAW_DB}:${unknown.join(',')}` } }
    }

    if (query.table === 'autopost_rules') return this.executeRuleQuery(query)
    if (query.table === 'autopost_jobs') return this.executeJobQuery(query)
    if (query.table === 'autopost_job_logs') return this.executeLogQuery(query)
    if (query.table === 'autopost_accounts') return this.executeAccountQuery(query)

    throw new Error(`unexpected fake table ${query.table}`)
  }

  private executeRuleQuery(query: FakeQuery) {
    if (query.type === 'select') return { data: this.rules.filter((rule) => matchesFilters(query, rule)), error: null }

    if (query.type === 'update') {
      const rule = this.rules.find(
        (candidate) =>
          candidate.id === eqFilter(query, 'id') &&
          candidate.user_id === eqFilter(query, 'user_id') &&
          candidate.approval_state === 'APPROVED' &&
          candidate.enabled === true &&
          candidate.paused_at === null &&
          candidate.revoked_at === null,
      )

      const hasReturnedRowContract = query.selectValue === 'id' && query.maybeSingleCalled
      if (!rule || !hasReturnedRowContract) return { data: null, error: null }

      Object.assign(rule, query.values)
      this.scheduleUpdates++
      return { data: { id: rule.id }, error: null }
    }

    throw new Error(`unexpected autopost_rules.${query.type}`)
  }

  private executeJobQuery(query: FakeQuery) {
    if (query.type === 'insert') {
      const duplicate = this.jobs.find(
        (job) =>
          job.rule_id === query.values.rule_id &&
          job.platform === query.values.platform &&
          job.scheduled_for === query.values.scheduled_for,
      )
      if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate' } }
      if (!query.selectValue || !query.singleCalled) return { data: null, error: { message: `${RAW_DB}:JOB_INSERT_RETURN_CONTRACT_MISSING` } }

      const job = { id: `job-${this.jobs.length + 1}`, ...query.values }
      this.jobs.push(job)
      return { data: pickJob(job), error: null }
    }

    if (query.type === 'select') {
      if (!query.maybeSingleCalled) return { data: null, error: { message: `${RAW_DB}:JOB_READBACK_MAYBE_SINGLE_MISSING` } }
      const id = eqFilter(query, 'id')
      const job = id
        ? this.jobs.find((candidate) => candidate.id === id)
        : this.jobs.find((candidate) => matchesFilters(query, candidate))
      return { data: job ?? null, error: null }
    }

    if (query.type === 'update') {
      const job = this.jobs.find((candidate) => candidate.id === eqFilter(query, 'id'))
      if (!job) return { data: null, error: null }

      const isLockUpdate = 'lock_id' in query.values && !('result_status' in query.values)
      if (isLockUpdate && !lockAllowed(query, job)) return { data: null, error: null }

      Object.assign(job, query.values)
      if ('result_status' in query.values) this.resultUpdates++
      return { data: pickJob(job), error: null }
    }

    throw new Error(`unexpected autopost_jobs.${query.type}`)
  }

  private executeLogQuery(query: FakeQuery) {
    if (query.type !== 'insert') throw new Error(`unexpected autopost_job_logs.${query.type}`)

    if (this.failJobLogs === 'throw-error') throw new Error(RAW_DB)
    if (this.failJobLogs === 'return-error') return { data: null, error: { message: RAW_DB } }

    assert.equal(typeof query.values.level, 'string')
    assert.ok(ALLOWED_LOG_LEVELS.has(query.values.level))
    assert.equal(query.values.level, query.values.level.toUpperCase())
    this.logs.push(query.values)
    return { data: null, error: null }
  }

  private executeAccountQuery(query: FakeQuery) {
    if (query.type === 'select') {
      const account = this.accounts.find((candidate) => matchesFilters(query, candidate))
      return { data: account ?? null, error: null }
    }

    if (query.type === 'update') {
      const account = this.accounts.find((candidate) => matchesFilters(query, candidate))
      if (!account) return { data: null, error: null }

      Object.assign(account, query.values)

      const successReturnedRowContract = query.selectValue === 'user_id' && query.maybeSingleCalled
      const successFiltersMatch =
        eqFilter(query, 'user_id') === account.user_id &&
        eqFilter(query, 'platform') === 'x' &&
        eqFilter(query, 'connection_status') === 'CONNECTED'

      if (query.selectValue || query.maybeSingleCalled) {
        if (successReturnedRowContract && successFiltersMatch) {
          this.events.push({
            type: 'db',
            table: 'autopost_accounts',
            operation: 'returned_row_confirmation',
            values: { user_id: account.user_id },
            select: query.selectValue,
            filters: query.filters,
            single: query.singleCalled,
            maybeSingle: query.maybeSingleCalled,
          })
          return { data: { user_id: account.user_id }, error: null }
        }
        return { data: null, error: null }
      }

      return { data: null, error: null }
    }

    throw new Error(`unexpected autopost_accounts.${query.type}`)
  }
}

function eqFilter(query: FakeQuery, column: string) {
  return query.filters.find((filter) => filter[0] === 'eq' && filter[1] === column)?.[2]
}

function matchesFilters(query: FakeQuery, row: Record<string, any>) {
  return query.filters.every((filter) => {
    if (filter[0] === 'eq') return row[filter[1]] === filter[2]
    if (filter[0] === 'is') return row[filter[1]] === filter[2]
    if (filter[0] === 'not') return row[filter[1]] !== null
    if (filter[0] === 'lte') return row[filter[1]] <= filter[2]
    return true
  })
}

function lockAllowed(query: FakeQuery, job: Job) {
  const observedAttemptCount = eqFilter(query, 'attempt_count')
  const orFilter = String(query.filters.find((filter) => filter[0] === 'or')?.[1] || '')
  const dueMatch = orFilter.match(/next_attempt_at\.lte\.([^,)]*)/)
  const retryDue = job.next_attempt_at === null || Boolean(dueMatch && job.next_attempt_at <= dueMatch[1])
  const lockFree = job.locked_at === null

  return (
    job.state === 'QUEUED' &&
    job.completed_at === null &&
    job.attempt_count === observedAttemptCount &&
    retryDue &&
    lockFree
  )
}

function pickJob(job: Job) {
  return {
    id: job.id,
    attempt_count: job.attempt_count,
    locked_at: job.locked_at,
    lock_id: job.lock_id,
    state: job.state,
    next_attempt_at: job.next_attempt_at,
    completed_at: job.completed_at,
    result_status: job.result_status,
    error_code: job.error_code,
    error_message: job.error_message,
  }
}

function makeRule(id: string) {
  return {
    id,
    user_id: `user-${id}`,
    approval_state: 'APPROVED',
    enabled: true,
    selected_platforms: ['x'],
    next_run_at: CURRENT_ISO,
    timezone: 'UTC',
    start_date: null,
    end_date: null,
    posts_per_day: 1,
    time_slots: ['12:00'],
    paused_at: null,
    revoked_at: null,
    content_payload: {
      platform: 'x',
      content_type: 'text',
      media_posting_enabled: false,
      text: `fixture text ${id}`,
    },
  }
}

function makeAccount(userId: string, expired = false) {
  return {
    user_id: userId,
    platform: 'x',
    connection_status: 'CONNECTED',
    encrypted_access_token: OLD_ENCRYPTED_ACCESS,
    encrypted_refresh_token: OLD_ENCRYPTED_REFRESH,
    token_expires_at: expired ? '2026-07-23T11:00:00.000Z' : '2026-07-24T12:00:00.000Z',
    token_type: 'bearer',
    token_key_version: 1,
    provider_username: 'local_x_user',
    provider_account_id: 'local-x-id',
    last_error: 'old',
    last_refresh_at: null,
  }
}

function makeRequest(query = 'dispatch=1') {
  return new Request(`http://local.test/api/autopost/run?${query}`, {
    headers: { authorization: 'Bearer dummy-cron-secret' },
  })
}

function decryptToken(value: string) {
  if (value === OLD_ENCRYPTED_ACCESS) return OLD_ACCESS
  if (value === NEW_ENCRYPTED_ACCESS) return NEW_ACCESS
  if (value === OLD_ENCRYPTED_REFRESH) return OLD_REFRESH
  throw new Error('local decrypt failed')
}

function encryptToken(value: string) {
  if (value === NEW_ACCESS) return NEW_ENCRYPTED_ACCESS
  if (value === NEW_REFRESH) return NEW_ENCRYPTED_REFRESH
  throw new Error('local encrypt failed')
}

async function runAutopost(args: {
  db: FakeSupabase
  fetcher: FakeFetch
  env?: Record<string, string | undefined>
  query?: string
}) {
  let adapterCalls = 0
  const refreshDeps = {
    supabaseAdmin: args.db as any,
    fetchImpl: args.fetcher.impl,
    decryptToken,
    encryptToken,
    getTokenKeyVersion: () => 2,
    getApiBaseUrl: () => API,
    env: { X_CLIENT_ID: CLIENT_ID, X_CLIENT_SECRET: CLIENT_SECRET },
    now,
  }
  const adapterDeps = {
    supabaseAdmin: args.db as any,
    fetchImpl: args.fetcher.impl,
    decryptToken,
    refreshAccessToken: (input: any) => refreshXAccessToken(input, refreshDeps),
    getApiBaseUrl: () => API,
    now,
  }

  const response = await executeAutopost(makeRequest(args.query ?? 'dispatch=1'), {
    supabaseAdmin: args.db as any,
    cronSecret: 'dummy-cron-secret',
    env: args.env ?? { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' },
    now,
    postXTextOnlyAutopost: (input: any) => {
      adapterCalls++
      return postXTextOnlyAutopost(input, adapterDeps)
    },
  })

  return { body: await response.json(), adapterCalls }
}

function makeFixture(id: string, options: { expired?: boolean; failJobLogs?: FakeSupabase['failJobLogs'] } = {}) {
  const events: Event[] = []
  const db = new FakeSupabase(events, id, options.expired ?? false)
  db.failJobLogs = options.failJobLogs ?? 'none'
  const fetcher = new FakeFetch(events)
  return { events, db, fetcher }
}

function safeSurface(db: FakeSupabase, body: unknown) {
  return {
    response: body,
    jobs: db.jobs.map((job) => ({
      result: job.result,
      error_code: job.error_code,
      error_message: job.error_message,
    })),
    logs: db.logs.map((log) => ({ message: log.message, meta: log.meta, level: log.level })),
    schedule: db.rules.map((rule) => ({ last_run_at: rule.last_run_at, next_run_at: rule.next_run_at })),
  }
}

function assertNoLeaks(db: FakeSupabase, body: unknown) {
  const serialized = JSON.stringify(safeSurface(db, body))
  for (const marker of FORBIDDEN_MARKERS) {
    assert.equal(serialized.includes(marker), false, `safe surface leaked ${marker}`)
  }
}

function eventIndex(events: Event[], label: string, predicate: (event: Event) => boolean) {
  const index = events.findIndex(predicate)
  assert.notEqual(index, -1, `missing event: ${label}`)
  return index
}

function dbEvent(event: Event, table: string, operation: string): event is DbEvent {
  return event.type === 'db' && event.table === table && event.operation === operation
}

function assertStrictOrder(indexes: number[]) {
  for (let i = 1; i < indexes.length; i++) {
    assert.ok(indexes[i - 1] < indexes[i], `event ${i - 1} must precede event ${i}`)
  }
}

function isProofReadback(event: Event, jobId: string) {
  return (
    dbEvent(event, 'autopost_jobs', 'select') &&
    event.maybeSingle === true &&
    typeof event.select === 'string' &&
    event.select.includes('result_status') &&
    event.select.includes('platform_post_id') &&
    JSON.stringify(event.filters).includes(`"${jobId}"`)
  )
}

function assertSuccessOrder(events: Event[], jobId: string) {
  const indexes = [
    eventIndex(events, 'job insert with attempt_count zero', (event) =>
      dbEvent(event, 'autopost_jobs', 'insert') && (event.values as any)?.attempt_count === 0,
    ),
    eventIndex(events, 'job lock update attempt one', (event) =>
      dbEvent(event, 'autopost_jobs', 'update') &&
      (event.values as any)?.attempt_count === 1 &&
      typeof (event.values as any)?.lock_id === 'string' &&
      !('result_status' in ((event.values as any) ?? {})),
    ),
    eventIndex(events, 'create-post fetch', (event) =>
      event.type === 'fetch' && event.endpoint === 'create_post' && event.url === TWEETS_ENDPOINT,
    ),
    eventIndex(events, 'POSTED result update', (event) =>
      dbEvent(event, 'autopost_jobs', 'update') && (event.values as any)?.result_status === 'POSTED',
    ),
    eventIndex(events, 'durable POSTED proof readback', (event) => isProofReadback(event, jobId)),
    eventIndex(events, 'schedule update', (event) => dbEvent(event, 'autopost_rules', 'update')),
  ]
  assertStrictOrder(indexes)
  assert.equal(events.filter((event) => dbEvent(event, 'autopost_rules', 'update')).length, 1)
}

function assertRefreshOrder(events: Event[], jobId: string) {
  const indexes = [
    eventIndex(events, 'connected account lookup', (event) =>
      dbEvent(event, 'autopost_accounts', 'select') && JSON.stringify(event.filters).includes('CONNECTED'),
    ),
    eventIndex(events, 'refresh fetch', (event) =>
      event.type === 'fetch' && event.endpoint === 'refresh' && event.url === TOKEN_ENDPOINT,
    ),
    eventIndex(events, 'refreshed credential update', (event) =>
      dbEvent(event, 'autopost_accounts', 'update') &&
      (event.values as any)?.encrypted_access_token === NEW_ENCRYPTED_ACCESS,
    ),
    eventIndex(events, 'refresh returned-row confirmation', (event) =>
      dbEvent(event, 'autopost_accounts', 'returned_row_confirmation') && event.select === 'user_id' && event.maybeSingle === true,
    ),
    eventIndex(events, 'create-post fetch after refresh', (event) =>
      event.type === 'fetch' && event.endpoint === 'create_post' && event.url === TWEETS_ENDPOINT,
    ),
    eventIndex(events, 'job result persistence after refresh', (event) =>
      dbEvent(event, 'autopost_jobs', 'update') && (event.values as any)?.result_status === 'POSTED',
    ),
    eventIndex(events, 'durable proof readback after refresh', (event) => isProofReadback(event, jobId)),
    eventIndex(events, 'schedule update after refresh', (event) => dbEvent(event, 'autopost_rules', 'update')),
  ]
  assertStrictOrder(indexes)
}

function assertJobInsertReturnedRowContract(db: FakeSupabase) {
  const insert = db.operations.find((operation) => operation.table === 'autopost_jobs' && operation.type === 'insert')
  assert.ok(insert)
  assert.ok(insert.select)
  assert.equal(insert.single, true)
  assert.equal(insert.values.attempt_count, 0)
  assert.equal(insert.values.next_attempt_at, null)
  assert.equal(insert.values.completed_at, null)
  assert.equal(insert.values.locked_at, null)
  assert.equal(insert.values.lock_id, null)
}

function assertScheduleReturnedRowContract(db: FakeSupabase) {
  const update = db.operations.find((operation) => operation.table === 'autopost_rules' && operation.type === 'update')
  assert.ok(update)
  assert.equal(update.select, 'id')
  assert.equal(update.maybeSingle, true)
  assert.ok(JSON.stringify(update.filters).includes('APPROVED'))
  assert.ok(JSON.stringify(update.filters).includes('paused_at'))
  assert.ok(JSON.stringify(update.filters).includes('revoked_at'))
}

function assertRefreshReturnedRowContract(db: FakeSupabase) {
  const update = db.operations.find(
    (operation) =>
      operation.table === 'autopost_accounts' &&
      operation.type === 'update' &&
      operation.values?.encrypted_access_token === NEW_ENCRYPTED_ACCESS,
  )
  assert.ok(update)
  assert.equal(update.select, 'user_id')
  assert.equal(update.maybeSingle, true)
  assert.ok(JSON.stringify(update.filters).includes('CONNECTED'))
}

function assertProofReadbackMaybeSingle(db: FakeSupabase, jobId: string) {
  assert.ok(
    db.operations.some(
      (operation) =>
        operation.table === 'autopost_jobs' &&
        operation.type === 'select' &&
        operation.maybeSingle === true &&
        operation.select?.includes('platform_post_id') &&
        JSON.stringify(operation.filters).includes(jobId),
    ),
  )
}

async function testSuccessfulPostedFlow() {
  currentNow = new Date(CURRENT_ISO)
  const { events, db, fetcher } = makeFixture('success')
  fetcher.enqueue(201, { data: { id: 'fake-provider-id' } })

  const out = await runAutopost({ db, fetcher })
  const job = db.jobs[0]
  const createPost = fetcher.createPostCalls()[0]

  assert.equal(db.rules.length, 1)
  assert.equal(db.accounts.length, 1)
  assert.equal(fetcher.refreshCalls().length, 0)
  assertJobInsertReturnedRowContract(db)
  assert.equal(job.attempt_count, 1)
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(createPost.url, TWEETS_ENDPOINT)
  assert.equal(createPost.method, 'POST')
  assert.equal(createPost.authorization, `Bearer ${OLD_ACCESS}`)
  assert.equal(createPost.contentType, 'application/json')
  assert.deepEqual(JSON.parse(createPost.body), { text: 'fixture text success' })
  assert.equal(job.state, 'SUCCEEDED')
  assert.equal(job.result_status, 'POSTED')
  assert.equal(job.platform_post_id, 'fake-provider-id')
  assert.equal(job.posted_at, CURRENT_ISO)
  assert.equal(job.completed_at, CURRENT_ISO)
  assert.equal(job.next_attempt_at, null)
  assert.equal(job.locked_at, null)
  assert.equal(job.lock_id, null)
  assert.equal(job.result.posted, true)
  assert.equal(job.result.platform_post_id, 'fake-provider-id')
  assertProofReadbackMaybeSingle(db, job.id)
  assertSuccessOrder(events, job.id)
  assertScheduleReturnedRowContract(db)
  assert.equal(db.scheduleUpdates, 1)
  assert.equal(db.rules[0].last_run_at, CURRENT_ISO)
  assert.equal(db.rules[0].next_run_at, NEXT_RUN_ISO)
  assert.equal(db.logs.filter((log) => log.message === 'schedule_advanced').length, 1)
  assert.equal(out.body.summary.results_posted, 1)
  assert.equal(out.body.summary.schedule_advancements, 1)
  assert.equal(out.body.summary.schedule_advancement_skipped, 0)
  assertNoLeaks(db, out.body)
}

async function testRateLimitRetryFlow() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('retry')
  fetcher.enqueue(429, { error: RAW_PROVIDER_BODY })

  const first = await runAutopost({ db, fetcher })
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(db.jobs[0].error_code, 'X_API_RATE_LIMITED')
  assert.equal(db.jobs[0].attempt_count, 1)
  assert.equal(db.jobs[0].state, 'QUEUED')
  assert.equal(db.jobs[0].result_status, 'FAILED')
  assert.equal(db.jobs[0].completed_at, null)
  assert.equal(db.jobs[0].platform_post_id, null)
  assert.equal(db.jobs[0].posted_at, null)
  assert.equal(db.jobs[0].locked_at, null)
  assert.equal(db.jobs[0].lock_id, null)
  assert.equal(db.jobs[0].next_attempt_at, RETRY_ISO)
  assert.equal(db.scheduleUpdates, 0)
  assert.equal(first.body.summary.results_failed, 1)
  assert.equal(first.body.summary.schedule_advancement_skipped, 1)
  assertNoLeaks(db, first.body)

  currentNow = new Date('2026-07-23T12:04:59.999Z')
  const beforeDue = await runAutopost({ db, fetcher })
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(fetcher.refreshCalls().length, 0)
  assert.equal(db.jobs[0].attempt_count, 1)
  assert.equal(db.resultUpdates, 1)
  assert.equal(db.jobs[0].next_attempt_at, RETRY_ISO)
  assert.equal(db.scheduleUpdates, 0)
  assert.equal(beforeDue.body.summary.retry_not_due, 1)
  assertNoLeaks(db, beforeDue.body)

  currentNow = new Date(RETRY_ISO)
  fetcher.enqueue(429, { error: RAW_PROVIDER_BODY })
  const exactDue = await runAutopost({ db, fetcher })
  assert.equal(fetcher.createPostCalls().length, 2)
  assert.equal(db.jobs[0].attempt_count, 2)
  assert.equal(db.scheduleUpdates, 0)
  assertNoLeaks(db, exactDue.body)
}

async function testRejectedFetchUncertainOutcome() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('throw')
  fetcher.throwNext(new Error(`${THROW_POST} ${OLD_ACCESS}`))

  const first = await runAutopost({ db, fetcher })
  const job = db.jobs[0]
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(job.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assert.equal(job.state, 'FAILED')
  assert.equal(job.result_status, 'FAILED')
  assert.equal(job.completed_at, CURRENT_ISO)
  assert.equal(job.next_attempt_at, null)
  assert.equal(job.platform_post_id, null)
  assert.equal(job.posted_at, null)
  assert.equal(job.locked_at, null)
  assert.equal(job.lock_id, null)
  assert.equal(job.result.status, 'FAILED')
  assert.equal(job.result.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assert.equal(db.scheduleUpdates, 0)
  assertNoLeaks(db, first.body)

  const later = await runAutopost({ db, fetcher })
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(later.body.summary.terminal_jobs_skipped, 1)
  assertNoLeaks(db, later.body)
}

async function testMissingDataIdUncertainOutcome() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('missing')
  fetcher.enqueue(200, { data: { id: '   ' }, raw: RAW_PROVIDER_BODY })

  const first = await runAutopost({ db, fetcher })
  const job = db.jobs[0]
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.notEqual(job.result_status, 'POSTED')
  assert.equal(job.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assert.equal(job.state, 'FAILED')
  assert.equal(job.result_status, 'FAILED')
  assert.equal(job.completed_at, CURRENT_ISO)
  assert.equal(job.next_attempt_at, null)
  assert.equal(job.platform_post_id, null)
  assert.equal(job.posted_at, null)
  assert.equal(job.locked_at, null)
  assert.equal(job.lock_id, null)
  assert.equal(db.scheduleUpdates, 0)
  assertNoLeaks(db, first.body)

  const later = await runAutopost({ db, fetcher })
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(later.body.summary.terminal_jobs_skipped, 1)
  assertNoLeaks(db, later.body)
}

async function testRefreshSuccessFlow() {
  currentNow = new Date(CURRENT_ISO)
  const { events, db, fetcher } = makeFixture('refresh', { expired: true })
  fetcher.enqueue(200, {
    access_token: NEW_ACCESS,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: NEW_REFRESH,
    scope: 'tweet.write users.read',
  })
  fetcher.enqueue(201, { data: { id: 'refresh-post-id' } })

  const out = await runAutopost({ db, fetcher })
  const refresh = fetcher.refreshCalls()[0]
  const createPost = fetcher.createPostCalls()[0]
  const job = db.jobs[0]

  assert.equal(fetcher.refreshCalls().length, 1)
  assert.equal(fetcher.createPostCalls().length, 1)
  assert.equal(refresh.method, 'POST')
  assert.equal(refresh.contentType, 'application/x-www-form-urlencoded')
  assert.equal(refresh.authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`)
  assert.equal(refresh.body.get('grant_type'), 'refresh_token')
  assert.equal(refresh.body.get('refresh_token'), OLD_REFRESH)
  assert.equal(db.accounts[0].encrypted_access_token, NEW_ENCRYPTED_ACCESS)
  assert.equal(db.accounts[0].encrypted_refresh_token, NEW_ENCRYPTED_REFRESH)
  assert.equal(db.accounts[0].connection_status, 'CONNECTED')
  assert.equal(db.accounts[0].last_error, null)
  assert.equal(db.accounts[0].token_expires_at, '2026-07-23T13:00:00.000Z')
  assert.equal(createPost.authorization, `Bearer ${NEW_ACCESS}`)
  assert.equal(job.state, 'SUCCEEDED')
  assert.equal(job.result_status, 'POSTED')
  assert.equal(db.scheduleUpdates, 1)
  assertRefreshReturnedRowContract(db)
  assertScheduleReturnedRowContract(db)
  assertRefreshOrder(events, job.id)
  assertNoLeaks(db, out.body)
}

async function testIncompleteRefreshFlow() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('badrefresh', { expired: true })
  fetcher.enqueue(200, {
    token_type: 'Bearer',
    expires_in: 3600,
    raw: RAW_PROVIDER_BODY,
  })

  const out = await runAutopost({ db, fetcher })
  const job = db.jobs[0]
  assert.equal(fetcher.refreshCalls().length, 1)
  assert.equal(fetcher.createPostCalls().length, 0)
  assert.equal(db.accounts[0].encrypted_access_token, OLD_ENCRYPTED_ACCESS)
  assert.equal(db.accounts[0].connection_status, 'ERROR')
  assert.equal(db.accounts[0].last_error, 'X_REFRESH_RESPONSE_INVALID')
  assert.equal(job.error_code, 'X_REFRESH_RESPONSE_INVALID')
  assert.equal(job.state, 'SKIPPED')
  assert.equal(job.result_status, 'NOT_CONFIGURED')
  assert.equal(job.completed_at, CURRENT_ISO)
  assert.equal(job.next_attempt_at, null)
  assert.equal(job.platform_post_id, null)
  assert.equal(job.posted_at, null)
  assert.equal(db.scheduleUpdates, 0)
  assertNoLeaks(db, out.body)
}

async function testRefreshFetchRejectionFlow() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('refreshthrow', { expired: true })
  fetcher.throwNext(new Error(`${THROW_REFRESH} ${OLD_REFRESH}`))

  const out = await runAutopost({ db, fetcher })
  assert.equal(fetcher.refreshCalls().length, 1)
  assert.equal(fetcher.createPostCalls().length, 0)
  assert.equal(db.jobs[0].error_code, 'X_REFRESH_FAILED')
  assert.equal(db.jobs[0].state, 'SKIPPED')
  assert.equal(db.scheduleUpdates, 0)
  assertNoLeaks(db, out.body)
}

async function testFoundationOnlyAndFutureRetryClaim() {
  currentNow = new Date(CURRENT_ISO)
  const foundation = makeFixture('foundation')
  const foundationResult = await runAutopost({
    db: foundation.db,
    fetcher: foundation.fetcher,
    env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' },
    query: 'foundation=1&claim=1',
  })

  assert.equal(foundationResult.adapterCalls, 0)
  assert.equal(foundation.fetcher.createPostCalls().length, 0)
  assert.equal(foundation.fetcher.refreshCalls().length, 0)
  assert.equal(foundation.db.jobs[0].attempt_count, 0)
  assert.equal(foundationResult.body.dispatch_enabled, false)
  assert.equal(foundationResult.body.summary.dispatches_attempted, 0)
  assert.equal(foundationResult.body.summary.posts_attempted, 0)
  assert.equal(foundation.db.resultUpdates, 0)
  assert.equal(foundation.db.scheduleUpdates, 0)
  assertNoLeaks(foundation.db, foundationResult.body)

  const futureRetry = makeFixture('future-retry')
  futureRetry.db.jobs.push({
    id: 'future-job',
    rule_id: 'future-retry',
    user_id: 'user-future-retry',
    platform: 'x',
    scheduled_for: CURRENT_ISO,
    payload: { text: 'fixture text future-retry' },
    state: 'QUEUED',
    result_status: 'FAILED',
    attempt_count: 1,
    next_attempt_at: '2026-07-23T13:00:00.000Z',
    completed_at: null,
    locked_at: null,
    lock_id: null,
    platform_post_id: null,
    posted_at: null,
    error_code: 'X_API_RATE_LIMITED',
    error_message: 'safe',
  })

  const futureResult = await runAutopost({
    db: futureRetry.db,
    fetcher: futureRetry.fetcher,
    env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'false' },
    query: 'foundation=1&claim=1',
  })
  const job = futureRetry.db.jobs[0]
  assert.equal(futureResult.body.claim_jobs, true)
  assert.equal(futureResult.adapterCalls, 0)
  assert.equal(futureRetry.fetcher.createPostCalls().length, 0)
  assert.equal(futureRetry.fetcher.refreshCalls().length, 0)
  assert.equal(job.locked_at, null)
  assert.equal(job.lock_id, null)
  assert.equal(job.attempt_count, 1)
  assert.equal(job.next_attempt_at, '2026-07-23T13:00:00.000Z')
  assert.equal(futureRetry.db.resultUpdates, 0)
  assert.equal(futureRetry.db.scheduleUpdates, 0)
  assert.equal(futureResult.body.summary.retry_not_due, 1)
  assert.equal(futureResult.body.summary.dispatches_attempted, 0)
  assert.equal(futureResult.body.summary.posts_attempted, 0)
  assertNoLeaks(futureRetry.db, futureResult.body)
}

async function testDualDispatchGate() {
  const cases: Array<{ id: string; query: string; env: Record<string, string | undefined>; expectedPosts: number }> = [
    { id: 'gate-absent', query: 'foundation=1', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' }, expectedPosts: 0 },
    { id: 'gate-false', query: 'dispatch=1', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'false' }, expectedPosts: 0 },
    { id: 'gate-uppercase', query: 'dispatch=1', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'TRUE' }, expectedPosts: 0 },
    { id: 'gate-one', query: 'dispatch=1', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: '1' }, expectedPosts: 0 },
    { id: 'gate-true', query: 'dispatch=1', env: { AUTOPOST_X_RUN_DISPATCH_ENABLED: 'true' }, expectedPosts: 1 },
  ]

  for (const testCase of cases) {
    currentNow = new Date(CURRENT_ISO)
    const { db, fetcher } = makeFixture(testCase.id)
    if (testCase.expectedPosts === 1) fetcher.enqueue(201, { data: { id: 'gate-id' } })

    const out = await runAutopost({ db, fetcher, env: testCase.env, query: testCase.query })
    assert.equal(fetcher.createPostCalls().length, testCase.expectedPosts)
    assert.equal(fetcher.refreshCalls().length, 0)
    assert.equal(out.body.dispatch_enabled, testCase.expectedPosts === 1)
    assertNoLeaks(db, out.body)
  }
}

async function testControlledJobLogFailure() {
  currentNow = new Date(CURRENT_ISO)
  const { db, fetcher } = makeFixture('log-failure', { failJobLogs: 'return-error' })
  fetcher.enqueue(201, { data: { id: 'posted-despite-log-failure' } })

  const out = await runAutopost({ db, fetcher })
  const job = db.jobs[0]
  assert.equal(job.state, 'SUCCEEDED')
  assert.equal(job.result_status, 'POSTED')
  assert.equal(job.platform_post_id, 'posted-despite-log-failure')
  assert.equal(db.scheduleUpdates, 1)
  assert.ok(out.body.summary.job_log_persistence_failures > 0)
  assertNoLeaks(db, out.body)
}

function testPublicDisabledPosture() {
  const registry = getAutopostPlatformRegistry()
  const x = registry.find((platform: any) => platform.id === 'x')
  assert.ok(x)
  assert.equal(x.launch_status, 'coming_soon')
  assert.equal(x.public_selectable, false)
  assert.equal(x.supports_real_posting, true)
  assert.equal(x.supports_async_dispatch, true)
  assert.equal(getSelectableAutopostPlatformIds().has('x'), false)

  const status = buildUserPlatformStatus(x, new Map())
  assert.equal(status.can_schedule, false)
  assert.equal(status.supports_real_posting, true)
  assert.equal(status.supports_text_posting, true)
  assert.equal(status.supports_media_posting, false)
  assert.equal(status.supports_async_dispatch, true)
}

async function main() {
  await testSuccessfulPostedFlow()
  await testRateLimitRetryFlow()
  await testRejectedFetchUncertainOutcome()
  await testMissingDataIdUncertainOutcome()
  await testRefreshSuccessFlow()
  await testIncompleteRefreshFlow()
  await testRefreshFetchRejectionFlow()
  await testFoundationOnlyAndFutureRetryClaim()
  await testDualDispatchGate()
  await testControlledJobLogFailure()
  testPublicDisabledPosture()

  console.log('integrated X route/adapter/refresh/persistence/retry/schedule behavior passed using local injected fakes; local injected behavioral evidence only; no real X request occurred; no OAuth action occurred; no live token was used; no Supabase endpoint was contacted; no Vercel endpoint was contacted; no Production action occurred; no SQL ran; no Supabase CLI action occurred; no cron was added; no OnlyFans, Fanvue, Reddit, or Generate action occurred.')
}

try {
  await main()
} finally {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv.get(key)
    if (originalValue === undefined) delete process.env[key]
    else process.env[key] = originalValue
  }
}
