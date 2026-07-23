import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'

const emptyServerOnlyModule = 'data:text/javascript,export%20{}'
const loaderSource = `export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }; return nextResolve(specifier, context) }`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const { postXTextOnlyAutopost } = await import('../../../lib/autopost/xAdapter')
const { classifyAutopostFailure, validateAdapterPostedProof, shouldAdvanceScheduleAfterProof } = await import('../../../lib/autopost/jobProof')
const { persistAutopostJobResult } = await import('../../../lib/autopost/jobResults')

const fixedNow = new Date('2026-07-23T12:34:56.789Z')
const expectedText = 'Hello X-04'
const encryptedAccessToken = 'encrypted-access-token-X04-secret'
const encryptedRefreshToken = 'encrypted-refresh-token-X04-secret'
const decryptedAccessToken = 'decrypted-access-token-X04-secret'
const providerBodySecret = 'raw-provider-body-X04-secret'
const providerDescriptionSecret = 'raw-provider-description-X04-secret'
const rejectedFetchSecret = 'rejected-fetch-X04-secret'
const dbFailureSecret = 'raw-db-failure-X04-secret'
const clientCredentialSecret = 'client-credential-X04-secret'
const allForbidden = [
  encryptedAccessToken,
  encryptedRefreshToken,
  decryptedAccessToken,
  providerBodySecret,
  providerDescriptionSecret,
  rejectedFetchSecret,
  dbFailureSecret,
  clientCredentialSecret,
]

type LookupMode = 'success' | 'error' | 'none'

type FetchCall = { url: string; init: any }

type FakeAccount = {
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  token_type: string | null
  token_key_version: number | null
  provider_username: string | null
  provider_account_id: string | null
}

class FakeAccountQuery {
  selectedColumns: string | null = null
  filters: Array<[string, string, unknown]> = []
  maybeSingleUsed = false
  constructor(private db: FakeAccountClient, private table: string) {}
  select(columns: string) { this.selectedColumns = columns; return this }
  eq(column: string, value: unknown) { this.filters.push(['eq', column, value]); return this }
  maybeSingle() {
    this.maybeSingleUsed = true
    this.db.lookups.push({ table: this.table, selectedColumns: this.selectedColumns, filters: this.filters, maybeSingleUsed: this.maybeSingleUsed })
    if (this.db.mode === 'error') return Promise.resolve({ data: null, error: { message: dbFailureSecret } })
    if (this.db.mode === 'none') return Promise.resolve({ data: null, error: null })
    return Promise.resolve({ data: this.db.account, error: null })
  }
}

class FakeAccountClient {
  lookups: Array<{ table: string; selectedColumns: string | null; filters: Array<[string, string, unknown]>; maybeSingleUsed: boolean }> = []
  account: FakeAccount
  constructor(public mode: LookupMode = 'success', account?: Partial<FakeAccount>) {
    this.account = {
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: '2026-07-23T12:40:00.000Z',
      token_type: 'bearer',
      token_key_version: 1,
      provider_username: 'x04-user',
      provider_account_id: 'x04-provider-account',
      ...account,
    }
  }
  from(table: string) { return new FakeAccountQuery(this, table) }
}

class FakePersistQuery {
  filters: Array<[string, string, unknown]> = []
  constructor(private db: FakePersistClient, private table: string, private type: 'update' | 'insert', private values: any) {}
  eq(column: string, value: unknown) {
    this.filters.push(['eq', column, value])
    this.db.ops.push({ table: this.table, type: this.type, values: this.values, filters: this.filters })
    return Promise.resolve({ error: null })
  }
  then(resolve: any, reject: any) {
    this.db.ops.push({ table: this.table, type: this.type, values: this.values, filters: this.filters })
    return Promise.resolve({ error: null }).then(resolve, reject)
  }
}

class FakePersistClient {
  ops: Array<{ table: string; type: string; values: any; filters: any[] }> = []
  from(table: string) {
    return {
      update: (values: any) => new FakePersistQuery(this, table, 'update', values),
      insert: (values: any) => new FakePersistQuery(this, table, 'insert', values),
    }
  }
}

function makeResponse(status: number, body: unknown, jsonReject?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonReject) throw new Error(jsonReject)
      return body
    },
  } as Response
}

function makeAdapterHarness(opts: {
  accountMode?: LookupMode
  account?: Partial<FakeAccount>
  response?: Response
  fetchReject?: Error
  decryptThrows?: boolean
  refreshResult?: any
} = {}) {
  const db = new FakeAccountClient(opts.accountMode ?? 'success', opts.account)
  const fetchCalls: FetchCall[] = []
  let refreshCalls = 0
  let decryptCalls = 0
  const deps = {
    supabaseAdmin: db as any,
    fetchImpl: (async (url: string, init: any) => {
      fetchCalls.push({ url, init })
      if (opts.fetchReject) throw opts.fetchReject
      return opts.response ?? makeResponse(200, { data: { id: 'x-post-123' } })
    }) as any,
    decryptToken: (token: string) => {
      decryptCalls += 1
      assert.equal(token, encryptedAccessToken)
      if (opts.decryptThrows) throw new Error('decrypt failed with secret should not escape')
      return decryptedAccessToken
    },
    refreshAccessToken: async () => {
      refreshCalls += 1
      if (opts.refreshResult) return opts.refreshResult
      throw new Error('unexpected refresh call')
    },
    getApiBaseUrl: () => 'https://api.x.invalid',
    now: () => fixedNow,
  }
  return { db, fetchCalls, deps, get refreshCalls() { return refreshCalls }, get decryptCalls() { return decryptCalls } }
}

async function runAdapter(opts: Parameters<typeof makeAdapterHarness>[0] = {}, input: any = {}) {
  const h = makeAdapterHarness(opts)
  const result = await postXTextOnlyAutopost({ run_mode: 'autopost', user_id: 'user-1', rule_id: 'rule-1', payload: { text: expectedText }, ...input }, h.deps)
  return { ...h, result }
}

function assertNoSecrets(value: unknown, forbidden = allForbidden) {
  const text = JSON.stringify(value)
  for (const secret of forbidden) assert.equal(text.includes(secret), false, `must not expose ${secret}`)
}
function assertNoProof(result: any) {
  assert.equal(result.ok, false)
  assert.equal(result.status, 'FAILED')
  assert.equal(result.platform, 'x')
  assert.equal('platform_post_id' in result, false)
  assert.equal('posted_at' in result, false)
}
async function assertUnknownForResponse(response: Response, label: string) {
  const { result, fetchCalls } = await runAdapter({ response })
  assertNoProof(result)
  assert.equal(result.error_code, 'X_POST_OUTCOME_UNKNOWN', label)
  assertNoSecrets(result)
  assert.equal(fetchCalls.length, 1)
}
function assertClassification(code: string, retryable: boolean, terminal: boolean, next: 'null' | 'non-null') {
  const c = classifyAutopostFailure(code, fixedNow)
  assert.equal(c.retryable, retryable)
  assert.equal(c.terminal, terminal)
  assert.equal(next === 'null' ? c.next_attempt_at === null : c.next_attempt_at !== null, true)
  assert.equal(c.error_code, code)
  return c
}

// 1, 2. Verified success and request construction.
{
  const { result, fetchCalls, refreshCalls, db } = await runAdapter({ response: makeResponse(200, { data: { id: 'x-post-123' } }) })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'POSTED')
  assert.equal(result.platform, 'x')
  assert.equal(result.platform_post_id, 'x-post-123')
  assert.equal(result.posted_at, fixedNow.toISOString())
  assert.equal(fetchCalls.length, 1)
  assert.equal(refreshCalls, 0)
  assert.equal(fetchCalls[0].url.endsWith('/2/tweets'), true)
  assert.equal(fetchCalls[0].init.method, 'POST')
  assert.equal(fetchCalls[0].init.headers.authorization, `Bearer ${decryptedAccessToken}`)
  assert.equal(fetchCalls[0].init.headers.authorization.includes(encryptedAccessToken), false)
  assert.equal(fetchCalls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { text: expectedText })
  assert.equal(db.lookups[0].table, 'autopost_accounts')
  assert.equal(db.lookups[0].selectedColumns?.includes('encrypted_access_token'), true)
  assert.deepEqual(db.lookups[0].filters, [['eq', 'user_id', 'user-1'], ['eq', 'platform', 'x'], ['eq', 'connection_status', 'CONNECTED']])
  assert.equal(db.lookups[0].maybeSingleUsed, true)
}

// 3. Rejected fetch resolves uncertain and leaks nothing.
{
  const { result, fetchCalls, refreshCalls } = await runAdapter({ fetchReject: new Error(`${rejectedFetchSecret} ${decryptedAccessToken}`) })
  assertNoProof(result)
  assert.equal(result.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assertNoSecrets(result)
  assert.equal(fetchCalls.length, 1)
  assert.equal(refreshCalls, 0)
}

// 4. HTTP 500 and 503 are terminal uncertain.
for (const status of [500, 503]) {
  const { result, fetchCalls, refreshCalls } = await runAdapter({ response: makeResponse(status, { secret: providerBodySecret }) })
  assertNoProof(result)
  assert.equal(result.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assertNoSecrets(result)
  const c = assertClassification('X_POST_OUTCOME_UNKNOWN', false, true, 'null')
  assert.equal(c.next_attempt_at, null)
  assert.equal(fetchCalls.length, 1)
  assert.equal(refreshCalls, 0)
}

// 5-8. Successful responses without durable data.id proof are uncertain.
await assertUnknownForResponse(makeResponse(200, null, `${providerDescriptionSecret} parse failure`), 'json parse rejection')
await assertUnknownForResponse(makeResponse(200, null), 'null body')
await assertUnknownForResponse(makeResponse(200, {}), 'missing data')
await assertUnknownForResponse(makeResponse(200, { data: {} }), 'missing data.id')
await assertUnknownForResponse(makeResponse(200, { data: { id: '' } }), 'empty data.id')
await assertUnknownForResponse(makeResponse(200, { data: { id: '   ' } }), 'whitespace data.id')
await assertUnknownForResponse(makeResponse(302, { secret: providerBodySecret }), 'non-success non-4xx')

// 9. HTTP 429 remains distinct and retryable classification only.
{
  const { result, fetchCalls, refreshCalls } = await runAdapter({ response: makeResponse(429, { secret: providerBodySecret }) })
  assertNoProof(result)
  assert.equal(result.error_code, 'X_API_RATE_LIMITED')
  assert.notEqual(result.error_code, 'X_POST_OUTCOME_UNKNOWN')
  const c = assertClassification('X_API_RATE_LIMITED', true, false, 'non-null')
  assert.notEqual(c.next_attempt_at, null)
  assertNoSecrets(result)
  assert.equal(fetchCalls.length, 1)
  assert.equal(refreshCalls, 0)
}

// 10-13. Explicit client rejections use narrow safe codes and no raw body.
for (const [status, code] of [[401, 'X_API_UNAUTHORIZED'], [403, 'X_API_FORBIDDEN'], [400, 'X_API_INVALID_REQUEST'], [422, 'X_API_INVALID_REQUEST'], [404, 'X_API_REJECTED'], [409, 'X_API_REJECTED']] as const) {
  const { result } = await runAdapter({ response: makeResponse(status, { secret: `${providerBodySecret} ${providerDescriptionSecret}` }) })
  assertNoProof(result)
  assert.equal(result.error_code, code)
  assertNoSecrets(result)
}

// 14. Explicit terminal classification and source evidence.
{
  const c = assertClassification('X_POST_OUTCOME_UNKNOWN', false, true, 'null')
  assert.deepEqual(c, { retryable: false, terminal: true, next_attempt_at: null, error_code: 'X_POST_OUTCOME_UNKNOWN' })
  const source = readFileSync('lib/autopost/jobProof.ts', 'utf8')
  assert.match(source, /TERMINAL_FAILURE_CODES[\s\S]*X_POST_OUTCOME_UNKNOWN/)
  assert.doesNotMatch(source, /RETRYABLE_FAILURE_CODES[\s\S]*X_POST_OUTCOME_UNKNOWN/)
}

// 15. Posted-proof normalization.
{
  const posted = validateAdapterPostedProof({ ok: true, status: 'POSTED', platform: 'x', platform_post_id: ' x-post-123 ', posted_at: fixedNow.toISOString() })
  assert.equal(posted.posted, true)
  assert.equal(posted.result_status, 'POSTED')
  assert.equal(posted.platform_post_id, 'x-post-123')
  for (const code of ['X_POST_OUTCOME_UNKNOWN', 'X_API_RATE_LIMITED', 'X_API_REJECTED']) {
    const proof = validateAdapterPostedProof({ ok: false, status: 'FAILED', platform: 'x', error_code: code, error_message: 'safe' })
    assert.equal(proof.posted, false)
    assert.equal(proof.result_status, 'FAILED')
    assert.equal(proof.platform_post_id, null)
    assert.equal(proof.error_code, code)
  }
}

// 16. Schedule advancement requires posted proof only.
{
  const uncertain = validateAdapterPostedProof({ ok: false, status: 'FAILED', platform: 'x', error_code: 'X_POST_OUTCOME_UNKNOWN' })
  const noAdvance = shouldAdvanceScheduleAfterProof(['x'], [uncertain])
  assert.equal(noAdvance.advance, false)
  assert.equal(noAdvance.reason, 'POSTED_PROOF_MISSING')
  const posted = validateAdapterPostedProof({ ok: true, status: 'POSTED', platform: 'x', platform_post_id: 'x-post-123' })
  const yesAdvance = shouldAdvanceScheduleAfterProof(['x'], [posted])
  assert.equal(yesAdvance.advance, true)
  assert.equal(yesAdvance.reason, 'ALL_REQUIRED_PLATFORMS_POSTED')
}

// 17. Uncertain-result persistence.
{
  const db = new FakePersistClient()
  const out = await persistAutopostJobResult(db as any, {
    job_id: 'job-x04',
    now: fixedNow,
    adapter_result: { ok: false, status: 'FAILED', platform: 'x', error_code: 'X_POST_OUTCOME_UNKNOWN', error_message: 'X post outcome could not be verified' },
  })
  const update = db.ops.find((o) => o.table === 'autopost_jobs' && o.type === 'update')!
  assert.equal(update.values.state, 'FAILED')
  assert.equal(update.values.result_status, 'FAILED')
  assert.equal(update.values.platform_post_id, null)
  assert.equal(update.values.posted_at, null)
  assert.equal(update.values.next_attempt_at, null)
  assert.equal(update.values.completed_at, fixedNow.toISOString())
  assert.equal(update.values.error_code, 'X_POST_OUTCOME_UNKNOWN')
  assert.equal(update.values.result.posted, false)
  assert.deepEqual({ ok: out.ok, job_result_persisted: out.job_result_persisted, persisted_status: out.persisted_status, posted: out.posted, platform_post_id: out.platform_post_id, retryable: out.retryable, terminal: out.terminal, next_attempt_at: out.next_attempt_at }, { ok: true, job_result_persisted: true, persisted_status: 'FAILED', posted: false, platform_post_id: null, retryable: false, terminal: true, next_attempt_at: null })
  assertNoSecrets(db.ops)
  assertNoSecrets(out)
}

// 18. Representative pre-provider local failures never create-post.
const preProviderCases: Array<{ name: string; input?: any; opts?: Parameters<typeof makeAdapterHarness>[0]; code: string; status?: string; refreshCalls?: number }> = [
  { name: 'invalid run mode', input: { run_mode: 'manual' }, code: 'INVALID_RUN_MODE' },
  { name: 'missing user', input: { user_id: '' }, code: 'MISSING_USER_ID' },
  { name: 'missing rule', input: { rule_id: '' }, code: 'MISSING_RULE_ID' },
  { name: 'missing payload', input: { payload: null }, code: 'MISSING_PAYLOAD' },
  { name: 'media payload', input: { payload: { text: 'hi', media: ['asset'] } }, code: 'X_TEXT_ONLY_MVP', status: 'UNSUPPORTED' },
  { name: 'empty text', input: { payload: { text: '   ' } }, code: 'EMPTY_X_TEXT' },
  { name: 'lookup error', opts: { accountMode: 'error' }, code: 'X_ACCOUNT_LOOKUP_FAILED' },
  { name: 'not connected', opts: { accountMode: 'none' }, code: 'X_ACCOUNT_NOT_CONNECTED', status: 'NOT_CONFIGURED' },
  { name: 'missing refresh token', opts: { account: { token_expires_at: '2026-07-23T12:34:00.000Z', encrypted_refresh_token: null } }, code: 'X_REFRESH_TOKEN_MISSING', status: 'NOT_CONFIGURED' },
  { name: 'refresh failure', opts: { account: { token_expires_at: '2026-07-23T12:34:00.000Z' }, refreshResult: { ok: false, error_code: 'X_REFRESH_UNAUTHORIZED', error_message: 'safe refresh failure' } }, code: 'X_REFRESH_UNAUTHORIZED', status: 'NOT_CONFIGURED', refreshCalls: 1 },
  { name: 'missing access token', opts: { account: { encrypted_access_token: null } }, code: 'X_ACCESS_TOKEN_MISSING', status: 'NOT_CONFIGURED' },
  { name: 'decrypt failure', opts: { decryptThrows: true }, code: 'X_TOKEN_DECRYPT_FAILED', status: 'NOT_CONFIGURED' },
]
for (const testCase of preProviderCases) {
  const { result, fetchCalls, refreshCalls } = await runAdapter(testCase.opts ?? {}, testCase.input ?? {})
  assert.equal(result.ok, false, testCase.name)
  assert.equal(result.error_code, testCase.code, testCase.name)
  assert.equal(result.status, testCase.status ?? 'FAILED', testCase.name)
  assert.equal(fetchCalls.length, 0, `${testCase.name}: no create-post fetch`)
  assert.equal(refreshCalls, testCase.refreshCalls ?? 0, `${testCase.name}: expected refresh boundary`)
  assertNoSecrets(result, allForbidden.filter((secret) => secret !== dbFailureSecret))
}

// 19. Refresh regression boundary: no module monkey-patching; adapter-level injection only.
assert.match(readFileSync('lib/autopost/xTokenRefresh.ts', 'utf8'), /export async function refreshXAccessToken/)

// 20. Runner injection preservation.
assert.match(readFileSync('app/api/autopost/run/route.ts', 'utf8'), /const postX = deps\.postXTextOnlyAutopost \?\? postXTextOnlyAutopost/)

console.log('X-04 provider outcome policy tests passed: local injected fakes only; no X, OAuth, Supabase, Vercel, Production, SQL, Supabase CLI, cron, OnlyFans, Fanvue, Reddit, Generate, live route, adapter route, real token, or real secret contacted or used')
