import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

type Op = { table: string; values: Record<string, unknown>; filters: unknown[][]; selectValue?: string; singleMode?: 'maybeSingle' }
const protectedKeys = ['encrypted_access_token', 'encrypted_refresh_token', 'token_expires_at', 'scopes', 'token_type', 'token_key_version', 'provider_account_id', 'provider_username', 'display_name', 'connected_at', 'last_refresh_at', 'metadata']
const prohibitedUpdateKeys = ['provider_account_id', 'provider_username', 'display_name', 'connected_at', 'metadata', 'user_id', 'platform']
const existingAccount = {
  encrypted_access_token: 'fake-existing-encrypted-access', encrypted_refresh_token: 'fake-old-encrypted-refresh',
  token_expires_at: '2026-07-24T00:00:00.000Z', scopes: ['fake.existing'], token_type: 'bearer', token_key_version: 3,
  provider_account_id: 'fake-provider-account', provider_username: 'fake-provider-user', display_name: 'Fake Display',
  connected_at: '2026-07-01T00:00:00.000Z', last_refresh_at: '2026-07-22T00:00:00.000Z', metadata: { fake: true },
  connection_status: 'CONNECTED', last_error: null,
}
class FakeQuery {
  filters: unknown[][] = []; selectValue?: string; singleMode?: 'maybeSingle'
  constructor(private db: FakeDb, private table: string, private values: Record<string, unknown>) {}
  eq(column: string, value: unknown) { this.filters.push(['eq', column, value]); return this }
  select(value: string) { this.selectValue = value; return this }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this }
  then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
    return Promise.resolve(this.db.execute({ table: this.table, values: this.values, filters: this.filters, selectValue: this.selectValue, singleMode: this.singleMode })).then(resolve, reject)
  }
}
class FakeDb {
  operations: Op[] = []; account = structuredClone(existingAccount)
  successMode: 'ok' | 'error' | 'zero' | 'multiple' = 'ok'; failFailureUpdate = false
  from(table: string) { return { update: (values: Record<string, unknown>) => new FakeQuery(this, table, values) } }
  execute(op: Op) {
    this.operations.push(op); assert.equal(op.table, 'autopost_accounts')
    if (isSuccess(op)) {
      assert.equal(op.selectValue, 'user_id'); assert.equal(op.singleMode, 'maybeSingle')
      if (this.successMode === 'error') return { data: null, error: { message: 'fake raw database diagnostic' } }
      if (this.successMode === 'zero') return { data: null, error: null }
      if (this.successMode === 'multiple') return { data: null, error: { message: 'fake multiple rows diagnostic' } }
      Object.assign(this.account, op.values); return { data: { user_id: 'fake-user' }, error: null }
    }
    if (this.failFailureUpdate) throw new Error('fake failure lifecycle diagnostic')
    Object.assign(this.account, op.values); return { data: null, error: null }
  }
}
const isSuccess = (op: Op) => 'encrypted_access_token' in op.values
const successes = (db: FakeDb) => db.operations.filter(isSuccess)
const failures = (db: FakeDb) => db.operations.filter((op) => !isSuccess(op))
const fixedNow = new Date('2026-07-23T10:00:00.000Z')
const valid = (overrides: Record<string, unknown> = {}) => ({ access_token: 'fake-access', token_type: 'Bearer', expires_in: 3600, ...overrides })
const response = (status: number, body: unknown, invalidJson = false) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (invalidJson) throw new SyntaxError('fake invalid json'); return body } }) as Response

type Options = { status?: number; invalidJson?: boolean; env?: Record<string, string | undefined>; clock?: () => Date; encrypt?: (token: string) => string; keyVersion?: () => number; decrypt?: (token: string) => string; fetchReject?: boolean; db?: FakeDb }
function harness(body: unknown, options: Options = {}) {
  const db = options.db ?? new FakeDb(); const fetchCalls: Array<{ url: string; init: RequestInit }> = []
  const encryptionInputs: string[] = []; let clockCalls = 0; let keyVersionCalls = 0; let decryptCalls = 0
  const deps = {
    supabaseAdmin: db as any,
    env: options.env ?? { X_CLIENT_ID: 'fake-client', X_CLIENT_SECRET: 'fake-secret' },
    now: () => { clockCalls++; return (options.clock ?? (() => new Date(fixedNow)))() },
    getApiBaseUrl: () => 'https://api.x.invalid',
    getTokenKeyVersion: () => { keyVersionCalls++; return (options.keyVersion ?? (() => 7))() },
    decryptToken: (token: string) => { decryptCalls++; return (options.decrypt ?? ((value) => value === 'fake-old-encrypted-refresh' ? 'fake-decrypted-refresh' : `fake-decrypted-${value}`))(token) },
    encryptToken: (token: string) => { encryptionInputs.push(token); return (options.encrypt ?? ((value) => value === 'fake-access' ? 'fake-new-encrypted-access' : value === 'fake-replacement-refresh' ? 'fake-new-encrypted-refresh' : 'fake-encrypted-opaque'))(token) },
    fetchImpl: async (url: string, init: RequestInit) => { fetchCalls.push({ url, init }); if (options.fetchReject) throw new Error('fake network diagnostic'); return response(options.status ?? 200, body, options.invalidJson) },
  }
  return { db, deps, fetchCalls, encryptionInputs, counts: { get clock() { return clockCalls }, get keyVersion() { return keyVersionCalls }, get decrypt() { return decryptCalls } } }
}
async function run(body: unknown, options: Options = {}) {
  const h = harness(body, options)
  const result = await refreshXAccessToken({ userId: 'fake-user', encryptedRefreshToken: 'fake-old-encrypted-refresh' }, h.deps)
  assertNoLeak(result, h.db)
  return { ...h, result }
}
function assertNoLeak(result: unknown, db: FakeDb) {
  const evidence = JSON.stringify({ result, operations: db.operations })
  for (const marker of ['fake-access', 'fake-replacement-refresh', 'fake-decrypted-refresh', 'fake-secret', 'raw provider diagnostic', 'raw database diagnostic', 'network diagnostic']) assert.equal(evidence.includes(marker), false, `sensitive marker escaped: ${marker}`)
}
function assertFailureOnly(context: Awaited<ReturnType<typeof run>>, code: string, status = 'ERROR') {
  assert.deepEqual(context.result, { ok: false, error_code: code, error_message: context.result.error_message })
  assert.equal(successes(context.db).length, 0); assert.equal(context.encryptionInputs.length, 0); assert.equal(context.counts.keyVersion, 0)
  assert.equal(failures(context.db).length, 1); assert.deepEqual(Object.keys(failures(context.db)[0].values).sort(), ['connection_status', 'last_error'])
  assert.deepEqual(failures(context.db)[0].values, { connection_status: status, last_error: code })
  for (const key of protectedKeys) assert.deepEqual((context.db.account as any)[key], (existingAccount as any)[key], `${key} preserved`)
  for (const op of context.db.operations) for (const key of prohibitedUpdateKeys) assert.equal(key in op.values, false)
}
function assertSuccessShape(db: FakeDb) {
  assert.equal(successes(db).length, 1); const op = successes(db)[0]
  assert.equal(op.table, 'autopost_accounts')
  assert.deepEqual(op.filters, [['eq', 'user_id', 'fake-user'], ['eq', 'platform', 'x'], ['eq', 'connection_status', 'CONNECTED']])
  assert.equal(op.selectValue, 'user_id'); assert.equal(op.singleMode, 'maybeSingle')
  for (const key of prohibitedUpdateKeys) assert.equal(key in op.values, false)
}

const priorDispatch = process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED
try {
  process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = 'false'
  assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED, 'false')

  for (const [label, body, invalidJson] of [
    ['null', null, false], ['string', 'fake string', false], ['number', 42, false], ['boolean', true, false],
    ['array', [], false], ['function', () => undefined, false], ['invalid JSON', undefined, true],
  ] as const) {
    const context = await run(body, { invalidJson }); assertFailureOnly(context, 'X_REFRESH_RESPONSE_INVALID'); assert.equal(context.fetchCalls.length, 1, label)
  }
  for (const body of [valid(), Object.assign(Object.create(null), valid())]) {
    const context = await run(body); assert.equal(context.result.ok, true); assertSuccessShape(context.db)
  }

  for (const access_token of [undefined, null, 123, '', '   ']) assertFailureOnly(await run(valid({ access_token })), 'X_REFRESH_RESPONSE_INVALID')
  {
    const context = await run(valid({ access_token: '  fake-access  ' }))
    assert.equal(context.result.ok, true); assert.deepEqual(context.encryptionInputs, ['fake-access'])
    assert.equal(JSON.stringify(context.db.operations).includes('  fake-access  '), false)
  }

  for (const token_type of [undefined, null, 123, '', '   ', 'mac']) assertFailureOnly(await run(valid({ token_type })), 'X_REFRESH_RESPONSE_INVALID')
  for (const token_type of ['bEaReR', '  Bearer  ']) {
    const context = await run(valid({ token_type })); assert.equal(successes(context.db)[0].values.token_type, 'bearer')
  }

  for (const expires_in of [undefined, null, '3600', NaN, Infinity, -Infinity, 0, -1, Number.MAX_VALUE]) {
    const context = await run(valid({ expires_in })); assertFailureOnly(context, 'X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH'); assert.equal(context.counts.clock, expires_in === Number.MAX_VALUE ? 1 : 0)
  }
  for (const clock of [() => new Date(NaN), () => { throw new Error('fake clock diagnostic') }]) {
    const context = await run(valid(), { clock }); assertFailureOnly(context, 'X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH'); assert.equal(context.counts.clock, 1)
  }
  {
    const context = await run(valid()); const write = successes(context.db)[0].values
    assert.equal(context.counts.clock, 1); assert.equal(write.token_expires_at, '2026-07-23T11:00:00.000Z'); assert.equal(write.last_refresh_at, fixedNow.toISOString())
  }

  {
    const context = await run(valid()); assert.equal(context.result.ok, true); assert.deepEqual(context.encryptionInputs, ['fake-access'])
    assert.equal(successes(context.db)[0].values.encrypted_refresh_token, 'fake-old-encrypted-refresh'); assert.equal(context.counts.decrypt, 1)
  }
  for (const refresh_token of [null, 123, {}, [], '', '   ']) assertFailureOnly(await run(valid({ refresh_token })), 'X_REFRESH_RESPONSE_INVALID')
  {
    const context = await run(valid({ refresh_token: '  fake-replacement-refresh  ' }))
    assert.deepEqual(context.encryptionInputs, ['fake-access', 'fake-replacement-refresh'])
    assert.equal(successes(context.db)[0].values.encrypted_refresh_token, 'fake-new-encrypted-refresh')
    assert.equal(JSON.stringify(context.db.operations).includes('  fake-replacement-refresh  '), false)
  }

  {
    const context = await run(valid()); assert.equal('scopes' in successes(context.db)[0].values, false); assert.deepEqual(context.db.account.scopes, existingAccount.scopes)
  }
  for (const scope of [null, 123, '', '   ']) assertFailureOnly(await run(valid({ scope })), 'X_REFRESH_RESPONSE_INVALID')
  {
    const context = await run(valid({ scope: ' tweet.read   users.read tweet.read offline.access ' }))
    assert.deepEqual(successes(context.db)[0].values.scopes, ['tweet.read', 'users.read', 'offline.access'])
  }

  for (const testEnv of [
    { X_CLIENT_SECRET: 'fake-secret' }, { X_CLIENT_ID: ' ', X_CLIENT_SECRET: 'fake-secret' },
    { X_CLIENT_ID: 'fake-client' }, { X_CLIENT_ID: 'fake-client', X_CLIENT_SECRET: ' ' },
  ]) {
    const context = await run(valid(), { env: testEnv }); assertFailureOnly(context, 'X_REFRESH_CLIENT_INVALID'); assert.equal(context.fetchCalls.length, 0)
  }
  {
    const context = await run(valid(), { env: { X_CLIENT_ID: '  fake-client  ', X_CLIENT_SECRET: '  fake-secret  ' } })
    const call = context.fetchCalls[0]; assert.equal(call.init.method, 'POST'); assert.equal(call.url, 'https://api.x.invalid/2/oauth2/token')
    assert.equal((call.init.headers as any).authorization, `Basic ${Buffer.from('fake-client:fake-secret').toString('base64')}`)
    assert.notEqual((call.init.headers as any).authorization, `Basic ${Buffer.from('  fake-client  :  fake-secret  ').toString('base64')}`)
    const form = call.init.body as URLSearchParams; assert.equal(form.get('grant_type'), 'refresh_token'); assert.equal(form.get('refresh_token'), 'fake-decrypted-refresh')
  }

  for (const [label, options] of [
    ['access encryption', { encrypt: () => { throw new Error('fake encryption diagnostic') } }],
    ['replacement encryption', { encrypt: (token: string) => { if (token === 'fake-replacement-refresh') throw new Error('fake encryption diagnostic'); return 'fake-new-encrypted-access' } }],
    ['key version', { keyVersion: () => { throw new Error('fake key diagnostic') } }],
  ] as const) {
    const body = label === 'replacement encryption' ? valid({ refresh_token: 'fake-replacement-refresh' }) : valid()
    const context = await run(body, options); assert.equal(context.result.error_code, 'X_REFRESH_FAILED'); assert.equal(successes(context.db).length, 0)
    assert.deepEqual(Object.keys(failures(context.db)[0].values).sort(), ['connection_status', 'last_error'])
    for (const key of protectedKeys) assert.deepEqual((context.db.account as any)[key], (existingAccount as any)[key])
  }

  {
    const context = await run(valid({ access_token: ' fake-access ', token_type: ' BEARER ', refresh_token: ' fake-replacement-refresh ', scope: 'tweet.read users.read tweet.read' }))
    assert.equal(context.result.ok, true); assertSuccessShape(context.db); assert.equal(context.counts.clock, 1); assert.equal(context.counts.keyVersion, 1)
    assert.deepEqual(context.encryptionInputs, ['fake-access', 'fake-replacement-refresh'])
    assert.deepEqual(successes(context.db)[0].values, {
      encrypted_access_token: 'fake-new-encrypted-access', encrypted_refresh_token: 'fake-new-encrypted-refresh', token_key_version: 7,
      token_expires_at: '2026-07-23T11:00:00.000Z', token_type: 'bearer', connection_status: 'CONNECTED',
      last_refresh_at: '2026-07-23T10:00:00.000Z', last_error: null, scopes: ['tweet.read', 'users.read'],
    })
  }

  {
    const context = await run({ error: 'invalid_grant', error_description: 'fake raw provider diagnostic' }, { status: 400 })
    assertFailureOnly(context, 'X_REFRESH_UNAUTHORIZED', 'EXPIRED')
  }
  {
    const context = await run({ error: 'invalid_client', error_description: 'fake raw provider diagnostic' }, { status: 401 })
    assertFailureOnly(context, 'X_REFRESH_CLIENT_INVALID')
  }
  for (const status of [429, 503]) assertFailureOnly(await run({ error: 'server_error' }, { status }), 'X_REFRESH_FAILED')
  assertFailureOnly(await run(valid(), { fetchReject: true }), 'X_REFRESH_FAILED')
  {
    const context = await run(valid(), { decrypt: () => { throw new Error('fake decrypt diagnostic') } })
    assertFailureOnly(context, 'X_REFRESH_TOKEN_DECRYPT_FAILED'); assert.equal(context.fetchCalls.length, 0)
  }
  for (const mode of ['error', 'zero', 'multiple'] as const) {
    const db = new FakeDb(); db.successMode = mode; if (mode !== 'multiple') db.failFailureUpdate = true
    const context = await run(valid(), { db }); assert.equal(context.result.error_code, 'X_REFRESH_ACCOUNT_UPDATE_FAILED')
    assert.equal(successes(db).length, 1); assert.equal(failures(db).length, 1); assert.deepEqual(Object.keys(failures(db)[0].values).sort(), ['connection_status', 'last_error'])
  }

  const availability = await readFile(new URL('../../../lib/autopost/platformAvailability.ts', import.meta.url), 'utf8')
  assert.match(availability, /platform\.id === "x"[\s\S]*?public_selectable:\s*false[\s\S]*?can_schedule:\s*false/)
  assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED, 'false')
  console.log('X token refresh contract tests passed; deterministic local injected evidence only, not provider, OAuth, Supabase, Production, runner, dispatch, or live-token proof.')
} finally {
  if (priorDispatch === undefined) delete process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED
  else process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = priorDispatch
}
