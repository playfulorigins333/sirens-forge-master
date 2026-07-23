import assert from 'node:assert/strict'
import { register } from 'node:module'

const emptyServerOnlyModule = 'data:text/javascript,export%20{}'
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const { refreshXAccessToken } = await import('../../../lib/autopost/xTokenRefresh')

type Op = { table: string; values: any; filters: any[]; selectValue?: string; singleMode?: 'maybeSingle' }

class FakeQuery {
  filters: any[] = []
  selectValue?: string
  singleMode?: 'maybeSingle'
  constructor(private db: FakeDb, private table: string, private values: any) {}
  eq(column: string, value: any) { this.filters.push(['eq', column, value]); return this }
  select(value: string) { this.selectValue = value; return this }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this }
  then(resolve: any, reject: any) {
    return Promise.resolve(this.db.execute({ table: this.table, values: this.values, filters: this.filters, selectValue: this.selectValue, singleMode: this.singleMode })).then(resolve, reject)
  }
}

class FakeDb {
  operations: Op[] = []
  failSuccessUpdate = false
  failFailureUpdate = false
  zeroRowsForSuccessUpdate = false
  multipleRowsForSuccessUpdate = false
  from(table: string) { return { update: (values: any) => new FakeQuery(this, table, values) } }
  execute(op: Op) {
    this.operations.push(op)
    if (op.table !== 'autopost_accounts') throw new Error('unexpected table')
    const success = isSuccessfulCredentialWrite(op)
    if (success) {
      if (op.selectValue !== 'user_id' || op.singleMode !== 'maybeSingle') return { data: null, error: { message: 'missing returned-row contract' } }
      if (this.failSuccessUpdate) return { data: null, error: { message: 'raw database failure that must not escape' } }
      if (this.multipleRowsForSuccessUpdate) return { data: null, error: { message: 'multiple rows returned' } }
      if (this.zeroRowsForSuccessUpdate) return { data: null, error: null }
      return { data: { user_id: 'user-1' }, error: null }
    }
    if (!success && this.failFailureUpdate) throw new Error('failure-state write failed')
    return { data: null, error: null }
  }
}

function isSuccessfulCredentialWrite(op: Op) {
  return 'encrypted_access_token' in op.values || 'encrypted_refresh_token' in op.values || (op.values.connection_status === 'CONNECTED' && op.values.last_error === null)
}
function successWrites(db: FakeDb) { return db.operations.filter(isSuccessfulCredentialWrite) }
function failureWrites(db: FakeDb) { return db.operations.filter((op) => !isSuccessfulCredentialWrite(op)) }
function assertNoSuccess(db: FakeDb) { assert.equal(successWrites(db).length, 0, 'no successful credential writes') }
function assertLifecycle(db: FakeDb, status: string, code?: string) {
  assert.equal(failureWrites(db).some((op) => op.values.connection_status === status && (!code || op.values.last_error === code)), true)
  assert.equal(failureWrites(db).some((op) => 'encrypted_access_token' in op.values || 'encrypted_refresh_token' in op.values || 'token_expires_at' in op.values || op.values.last_error === null), false)
}
function assertNoNullConnectedExpiry(db: FakeDb) {
  assert.equal(db.operations.some((op) => op.values.connection_status === 'CONNECTED' && op.values.token_expires_at === null), false)
}
function assertSafe(result: any, forbidden = ['raw provider diagnostic that must not escape', 'secret-access', 'secret-refresh', 'dummy-secret', 'raw database failure']) {
  const text = JSON.stringify(result)
  for (const value of forbidden) assert.equal(text.includes(value), false, `must not expose ${value}`)
}

const fixedNow = new Date('2026-07-23T10:00:00.000Z')
const env = { X_CLIENT_ID: 'dummy-client', X_CLIENT_SECRET: 'dummy-secret' }
function makeResponse(status: number, body: unknown): Response { return { ok: status >= 200 && status < 300, status, json: async () => body } as Response }
function makeDeps(body: unknown, status = 200, extra: any = {}) {
  const db = new FakeDb()
  const fetchCalls: any[] = []
  const deps = {
    supabaseAdmin: db as any,
    env,
    now: () => fixedNow,
    getApiBaseUrl: () => 'https://api.x.invalid',
    getTokenKeyVersion: () => 7,
    decryptToken: (token: string) => token === 'old-encrypted-refresh' ? 'decrypted-refresh-token' : `decrypted:${token}`,
    encryptToken: (token: string) => token === 'secret-access' ? 'encrypted-access-token' : token === 'secret-refresh' ? 'encrypted-replacement-refresh-token' : `encrypted-local-${token.length}`,
    fetchImpl: async (url: string, init: any) => { fetchCalls.push({ url, init }); return makeResponse(status, body) },
    ...extra,
  }
  return { db, deps, fetchCalls }
}
async function run(body: unknown, status = 200, extra: any = {}) {
  const context = makeDeps(body, status, extra)
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, context.deps)
  assertSafe(result)
  return { ...context, result }
}
const valid = (overrides: Record<string, unknown> = {}) => ({ access_token: 'secret-access', token_type: 'Bearer', expires_in: 3600, ...overrides })

{
  const { db, result, fetchCalls } = await run(valid())
  assert.equal(result.ok, true)
  assert.equal(successWrites(db).length, 1)
  const write = successWrites(db)[0].values
  assert.equal(write.encrypted_access_token, 'encrypted-access-token')
  assert.equal(write.encrypted_refresh_token, 'old-encrypted-refresh')
  assert.equal(write.token_expires_at, '2026-07-23T11:00:00.000Z')
  assert.equal(write.token_type, 'bearer')
  assert.equal(write.connection_status, 'CONNECTED')
  assert.equal(write.last_error, null)
  assert.equal('scopes' in write, false)
  assert.deepEqual(successWrites(db)[0].filters, [['eq', 'user_id', 'user-1'], ['eq', 'platform', 'x'], ['eq', 'connection_status', 'CONNECTED']])
  assert.equal(successWrites(db)[0].selectValue, 'user_id')
  assert.equal(successWrites(db)[0].singleMode, 'maybeSingle')
  assert.equal(fetchCalls[0].url.endsWith('/2/oauth2/token'), true)
  assert.equal(fetchCalls[0].init.method, 'POST')
  assert.equal(fetchCalls[0].init.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(fetchCalls[0].init.headers.authorization, `Basic ${Buffer.from('dummy-client:dummy-secret').toString('base64')}`)
  assert.equal(fetchCalls[0].init.body.get('grant_type'), 'refresh_token')
  assert.equal(fetchCalls[0].init.body.get('refresh_token'), 'decrypted-refresh-token')
}
{
  const { db, result } = await run(valid({ refresh_token: 'secret-refresh' }))
  assert.equal(result.ok, true)
  assert.equal(successWrites(db).length, 1)
  assert.equal(successWrites(db)[0].values.encrypted_refresh_token, 'encrypted-replacement-refresh-token')
  assert.notEqual(successWrites(db)[0].values.encrypted_refresh_token, 'old-encrypted-refresh')
}
for (const [body, code] of [
  [valid({ access_token: undefined }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ access_token: '' }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ access_token: '   ' }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ token_type: undefined }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ token_type: '   ' }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ token_type: 'mac' }), 'X_REFRESH_RESPONSE_INVALID'],
  [valid({ expires_in: undefined }), 'X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH'],
] as const) {
  const { db, result } = await run(body)
  assert.equal(result.ok, false)
  assert.equal(result.error_code, code)
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', code); assertNoNullConnectedExpiry(db)
}
{
  const { db } = await run(valid({ token_type: 'bEaReR' }))
  assert.equal(successWrites(db)[0].values.token_type, 'bearer')
}
for (const expires_in of [0, -1, '3600', NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
  const { db, result } = await run(valid({ expires_in }))
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH')
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH'); assertNoNullConnectedExpiry(db)
}
for (const refresh_token of ['', '   ', 123]) {
  const { db, result } = await run(valid({ refresh_token }))
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'X_REFRESH_RESPONSE_INVALID')
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_RESPONSE_INVALID')
  assert.equal(db.operations.some((op) => JSON.stringify(op.values).includes('secret-refresh')), false)
}
{
  const { db } = await run(valid({ scope: undefined }))
  assert.equal('scopes' in successWrites(db)[0].values, false)
}
{
  const { db } = await run(valid({ scope: 'tweet.read users.read offline.access' }))
  assert.deepEqual(successWrites(db)[0].values.scopes, ['tweet.read', 'users.read', 'offline.access'])
}
for (const scope of [123, '   ']) {
  const { db, result } = await run(valid({ scope }))
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'X_REFRESH_RESPONSE_INVALID')
  assertNoSuccess(db)
}
{
  const { db, result } = await run({ error: 'invalid_grant', error_description: 'raw provider diagnostic that must not escape' }, 400)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_UNAUTHORIZED')
  assertNoSuccess(db); assertLifecycle(db, 'EXPIRED', 'X_REFRESH_UNAUTHORIZED'); assertSafe(result)
}
{
  const { db, result } = await run({ error: 'invalid_client', error_description: 'raw provider diagnostic that must not escape' }, 401)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_CLIENT_INVALID')
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_CLIENT_INVALID'); assertSafe(result)
}
for (const status of [429, 503]) {
  const { db, result } = await run({ error: 'server_error' }, status)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_FAILED')
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_FAILED')
}
{
  const db = new FakeDb(); const fetchCalls: any[] = []
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, { ...makeDeps(valid()).deps, supabaseAdmin: db as any, fetchImpl: async () => { fetchCalls.push(1); throw new Error('network') } })
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_FAILED')
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_FAILED')
}
{
  const { db, deps, fetchCalls } = makeDeps(valid())
  db.zeroRowsForSuccessUpdate = true; db.failFailureUpdate = true
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, deps)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_ACCOUNT_UPDATE_FAILED')
  assertSafe(result); assert.equal(fetchCalls.length, 1); assert.equal(successWrites(db).length, 1); assert.equal(failureWrites(db).length, 1)
}
{
  const { db, deps } = makeDeps(valid())
  db.failSuccessUpdate = true; db.failFailureUpdate = true
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, deps)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_ACCOUNT_UPDATE_FAILED')
  assertSafe(result); assert.equal(successWrites(db).length, 1); assert.equal(failureWrites(db).length, 1)
}
{
  const { db, deps } = makeDeps(valid())
  db.multipleRowsForSuccessUpdate = true
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, deps)
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_ACCOUNT_UPDATE_FAILED')
  assertSafe(result); assert.equal(successWrites(db).length, 1); assert.equal(failureWrites(db).length, 1)
}
{
  const db = new FakeDb(); const fetchCalls: any[] = []
  const result = await refreshXAccessToken({ userId: 'user-1', encryptedRefreshToken: 'old-encrypted-refresh' }, { ...makeDeps(valid()).deps, supabaseAdmin: db as any, decryptToken: () => { throw new Error('decrypt') }, fetchImpl: async () => { fetchCalls.push(1); return makeResponse(200, valid()) } })
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_TOKEN_DECRYPT_FAILED')
  assert.equal(fetchCalls.length, 0); assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_TOKEN_DECRYPT_FAILED')
}
for (const envOverride of [
  { X_CLIENT_ID: '', X_CLIENT_SECRET: 'dummy-secret' },
  { X_CLIENT_ID: '   ', X_CLIENT_SECRET: 'dummy-secret' },
  { X_CLIENT_ID: 'dummy-client', X_CLIENT_SECRET: '   ' },
]) {
  const { db, result, fetchCalls } = await run(valid(), 200, { env: envOverride, fetchImpl: async () => { throw new Error('must not fetch') } })
  assert.equal(result.ok, false); assert.equal(result.error_code, 'X_REFRESH_CLIENT_INVALID')
  assert.equal(fetchCalls.length, 0)
  assertNoSuccess(db); assertLifecycle(db, 'ERROR', 'X_REFRESH_CLIENT_INVALID')
}

console.log('X token refresh contract tests passed; local injected behavioral evidence only, not X-provider, OAuth, Supabase, Production, or live-token proof.')
