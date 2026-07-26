import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

const emptyModule = "data:text/javascript,export%20{}"
const nextServerModule = `data:text/javascript,${encodeURIComponent(`
class MockResponse {
  constructor(body, init = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.headers = new Headers(init.headers)
  }
  static json(body, init) { return new MockResponse(body, init) }
}
export { MockResponse as NextResponse }
`)}`
const supabaseServerModule = `data:text/javascript,${encodeURIComponent(
  "export const requireUserId = input => globalThis.__xLiveRoute.requireUserId(input)"
)}`
const supabaseAdminModule = `data:text/javascript,${encodeURIComponent(
  "export const getSupabaseAdmin = () => globalThis.__xLiveRoute.getSupabaseAdmin()"
)}`

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyModule)}, shortCircuit: true }
  if (specifier === 'next/server') return { url: ${JSON.stringify(nextServerModule)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseServer') return { url: ${JSON.stringify(supabaseServerModule)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseAdmin') return { url: ${JSON.stringify(supabaseAdminModule)}, shortCircuit: true }
  if (specifier.toLowerCase().includes('fanvue')) globalThis.__xFanvueResolutions = (globalThis.__xFanvueResolutions || 0) + 1
  return nextResolve(specifier, context)
}
`)}`, import.meta.url)

type Fetch = typeof fetch
type Counters = {
  accountLoads: number
  keyCalls: number
  decryptCalls: number
  timeoutCalls: number
  fetchCalls: number
}

const routeHooks: Record<string, (...args: any[]) => any> = {}
;(globalThis as any).__xLiveRoute = routeHooks
;(globalThis as any).__xFanvueResolutions = 0

const canary = await import("../../../lib/autopost/xLiveTextCanary.ts")
const posture = await import("../../../lib/autopost/xStoredPosture.ts")
assert.equal((globalThis as any).__xFanvueResolutions, 0, "canary graph resolved no Fanvue module")

const adapter = await import("../../../lib/autopost/xAdapter.ts")
const availability = await import("../../../lib/autopost/platformAvailability.ts")
const registry = await import("../../../lib/autopost/platformRegistry.ts")
const route = await import("../../../app/api/admin/autopost/x/live-text-canary/route.ts")

const NOW = new Date("2030-01-01T00:00:00.000Z")
const SECRET_MARKERS = [
  "DECRYPTED_ACCESS_MARKER",
  "ENCRYPTED_ACCESS_MARKER",
  "ENCRYPTED_REFRESH_MARKER",
  "PROVIDER_ACCOUNT_MARKER",
  "The_beard0302",
  "AUTHENTICATED_USER_MARKER",
  "Bearer DECRYPTED_ACCESS_MARKER",
  "RAW_PROVIDER_BODY_MARKER",
  "RAW_DATABASE_ERROR_MARKER",
  "RAW_EXCEPTION_MARKER",
  "TOKEN_KEY_MATERIAL_MARKER",
  "CLIENT_SECRET_MARKER",
  "SERVICE_ROLE_MARKER",
]
const validAccount: any = {
  connection_status: "CONNECTED",
  provider_account_id: "PROVIDER_ACCOUNT_MARKER",
  provider_username: "The_beard0302",
  last_error: null,
  encrypted_access_token: "ENCRYPTED_ACCESS_MARKER",
  encrypted_refresh_token: "ENCRYPTED_REFRESH_MARKER",
  token_expires_at: "2035-01-01T00:00:00.000Z",
  token_key_version: 7,
  metadata: { provider: "x", identity_fetched: true },
}

function assertSanitized(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const marker of SECRET_MARKERS) assert.equal(serialized.includes(marker), false, marker)
}

function assertFixedFlags(result: any, expected: { provider?: boolean; verified?: boolean; uncertain?: boolean } = {}) {
  assert.equal(result.provider_request_attempted, expected.provider ?? false)
  assert.equal(result.post_attempted, expected.provider ?? false)
  assert.equal(result.post_verified, expected.verified ?? false)
  assert.equal(result.outcome_uncertain, expected.uncertain ?? false)
  for (const key of [
    "database_write_attempted", "refresh_attempted", "retry_attempted", "runner_invoked",
    "scheduler_action_attempted", "cron_action_attempted", "public_enablement_attempted",
    "fanvue_account_queried", "fanvue_account_mutated",
  ]) assert.equal(result[key], false, key)
  assertSanitized(result)
}

function harness(overrides: Record<string, unknown> = {}) {
  const counters: Counters = { accountLoads: 0, keyCalls: 0, decryptCalls: 0, timeoutCalls: 0, fetchCalls: 0 }
  const timeoutValues: number[] = []
  const rawFetch = (overrides.fetchImpl as Fetch | undefined) ?? (async () =>
    new Response(JSON.stringify({ data: { id: " post-id " } }), { status: 201 })) as Fetch
  const deps: any = {
    loadAccount: async () => {
      counters.accountLoads++
      if (overrides.lookupThrows) throw new Error("RAW_DATABASE_ERROR_MARKER")
      return overrides.account === undefined ? structuredClone(validAccount) : overrides.account
    },
    getTokenKeyVersion: () => {
      counters.keyCalls++
      if (overrides.keyThrows) throw new Error("RAW_EXCEPTION_MARKER")
      return "keyVersion" in overrides ? overrides.keyVersion : 7
    },
    decryptToken: () => {
      counters.decryptCalls++
      if (overrides.decryptThrows) throw new Error("RAW_EXCEPTION_MARKER")
      return "decrypted" in overrides ? overrides.decrypted : "DECRYPTED_ACCESS_MARKER"
    },
    now: () => {
      if (overrides.nowThrows) throw new Error("RAW_EXCEPTION_MARKER")
      return overrides.nowValue ?? new Date(NOW)
    },
    getApiBaseUrl: () => {
      if (overrides.configThrows) throw new Error("RAW_EXCEPTION_MARKER")
      return overrides.apiBase ?? "https://api.x.com"
    },
    createTimeoutSignal: (milliseconds: number) => {
      counters.timeoutCalls++
      timeoutValues.push(milliseconds)
      return overrides.signal ?? new AbortController().signal
    },
    fetchImpl: (async (...args: Parameters<Fetch>) => {
      counters.fetchCalls++
      return rawFetch(...args)
    }) as Fetch,
  }
  return { counters, deps, timeoutValues }
}

function assertPreProviderStopped(value: ReturnType<typeof harness>) {
  assert.equal(value.counters.timeoutCalls, 0)
  assert.equal(value.counters.fetchCalls, 0)
}

function fakeAccountClient(data: unknown, error: unknown = null) {
  const operations: unknown[] = []
  const builder: any = {
    select(columns: string) { operations.push(["select", columns]); return this },
    eq(column: string, value: unknown) { operations.push(["eq", column, value]); return this },
    async maybeSingle() { operations.push(["maybeSingle"]); return { data, error } },
    update() { throw new Error("mutation prohibited") },
    upsert() { throw new Error("mutation prohibited") },
    insert() { throw new Error("mutation prohibited") },
    delete() { throw new Error("mutation prohibited") },
  }
  const client: any = {
    from(table: string) { operations.push(["from", table]); return builder },
    rpc() { throw new Error("mutation prohibited") },
  }
  return { client, operations }
}

// Exact X-only account read and no mutation capability.
{
  const fake = fakeAccountClient(validAccount)
  const result = await canary.createXLiveTextCanaryAccountLoader(fake.client)("AUTHENTICATED_USER_MARKER")
  assert.deepEqual(result, validAccount)
  assert.deepEqual(fake.operations, [
    ["from", "autopost_accounts"],
    ["select", canary.X_LIVE_CANARY_ACCOUNT_SELECT],
    ["eq", "user_id", "AUTHENTICATED_USER_MARKER"],
    ["eq", "platform", "x"],
    ["maybeSingle"],
  ])
}

// Account lookup errors are sanitized and stop all privileged token/provider work.
{
  const value = harness({ lookupThrows: true })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_ACCOUNT_LOOKUP_FAILED")
  assert.equal(value.counters.keyCalls, 0)
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
  assertFixedFlags(result)
}

// Every canonical posture blocker is unchanged and terminates before timeout/fetch.
const postureCases: Array<[string, any]> = [
  ["missing row", null],
  ["disconnected", { connection_status: "DISCONNECTED" }],
  ["expired", { connection_status: "EXPIRED" }],
  ["revoked", { connection_status: "REVOKED" }],
  ["error", { connection_status: "ERROR" }],
  ["unknown status", { connection_status: "UNKNOWN" }],
  ["missing provider ID", { provider_account_id: " " }],
  ["missing username", { provider_username: " " }],
  ["missing access token", { encrypted_access_token: "" }],
  ["missing refresh token", { encrypted_refresh_token: "" }],
  ["invalid expiry", { token_expires_at: "invalid" }],
  ["invalid key", { token_key_version: 0 }],
  ["missing metadata", { metadata: { provider: "other", identity_fetched: true } }],
  ["identity unconfirmed", { metadata: { provider: "x", identity_fetched: false } }],
  ["last error", { last_error: "RAW_DATABASE_ERROR_MARKER" }],
]
for (const [name, patch] of postureCases) {
  const account = patch === null ? null : { ...validAccount, ...patch }
  const value = harness({ account })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_ACCOUNT_NOT_READY", name)
  assert.ok(posture.getXStoredPostureBlocker(account), name)
  assert.equal(value.counters.keyCalls, 0, name)
  assert.equal(value.counters.decryptCalls, 0, name)
  assertPreProviderStopped(value)
  assertFixedFlags(result)
}

// Protected username, key, clock, expiry, decryption and configuration failures stop pre-provider.
for (const username of ["different", "@The_beard0302"]) {
  const value = harness({ account: { ...validAccount, provider_username: username } })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_PROTECTED_USERNAME_MISMATCH")
  assert.equal(value.counters.keyCalls, 0)
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
}
for (const keyVersion of [undefined, "7", NaN, Infinity, 7.5, 0, -1]) {
  const value = harness({ keyVersion })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE")
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
}
for (const overrides of [{ keyThrows: true }, { keyVersion: 8 }]) {
  const value = harness(overrides)
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, overrides.keyThrows ? "X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE" : "X_LIVE_CANARY_TOKEN_KEY_VERSION_MISMATCH")
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
}
for (const overrides of [{ nowThrows: true }, { nowValue: new Date("invalid") }]) {
  const value = harness(overrides)
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING")
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
  assertSanitized(result)
}
for (const delta of [0, 59_999, 60_000]) {
  const value = harness({ account: { ...validAccount, token_expires_at: new Date(NOW.getTime() + delta).toISOString() } })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING")
  assert.equal(value.counters.decryptCalls, 0)
  assertPreProviderStopped(value)
}
for (const decrypted of [null, "", "   ", 42, true, { token: "value" }]) {
  const value = harness({ decrypted })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_ACCESS_TOKEN_INVALID")
  assertPreProviderStopped(value)
}
{
  const value = harness({ decryptThrows: true })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_ACCESS_TOKEN_DECRYPT_FAILED")
  assertPreProviderStopped(value)
}
for (const apiBase of [
  "not a url", "http://api.x.com", "https://other.invalid", "https://api.x.com:444",
  "https://user@api.x.com", "https://user:password@api.x.com", "https://api.x.com?q=1",
  "https://api.x.com#fragment", "https://api.x.com/unexpected",
]) {
  const value = harness({ apiBase })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_PROVIDER_CONFIG_INVALID", apiBase)
  assertPreProviderStopped(value)
}

// Exact provider request and fixed 10-second signal.
{
  const suppliedSignal = new AbortController().signal
  let request: [unknown, RequestInit | undefined] | undefined
  const value = harness({
    signal: suppliedSignal,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      request = [url, init]
      return new Response(JSON.stringify({ data: { id: " post-id " } }), { status: 201 })
    },
  })
  const result = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, "X_LIVE_CANARY_SUCCEEDED")
  assert.equal(result.post_id, "post-id")
  assert.deepEqual(value.timeoutValues, [10_000])
  assert.equal(value.counters.fetchCalls, 1)
  assert.equal(String(request?.[0]), "https://api.x.com/2/tweets")
  assert.equal(request?.[1]?.method, "POST")
  assert.equal(request?.[1]?.signal, suppliedSignal)
  assert.deepEqual(request?.[1]?.headers, { authorization: "Bearer DECRYPTED_ACCESS_MARKER", "content-type": "application/json" })
  assert.equal(request?.[1]?.body, '{"text":"Testing a new posting workflow. No action needed."}')
  assert.deepEqual(Object.keys(JSON.parse(String(request?.[1]?.body))), ["text"])
  assertFixedFlags(result, { provider: true, verified: true })
}

async function assertProviderFailure(fetchImpl: Fetch, safeCode: string, uncertain: boolean, signal?: AbortSignal) {
  const value = harness({ fetchImpl, ...(signal ? { signal } : {}) })
  const result: any = await canary.runXLiveTextCanary("AUTHENTICATED_USER_MARKER", value.deps)
  assert.equal(result.safe_code, safeCode)
  assert.equal(value.counters.fetchCalls, 1)
  assert.equal("post_id" in result, false)
  assertFixedFlags(result, { provider: true, uncertain })
}
for (const [status, code, uncertain] of [
  [401, "X_LIVE_CANARY_X_UNAUTHORIZED", false], [403, "X_LIVE_CANARY_X_FORBIDDEN", false],
  [429, "X_LIVE_CANARY_X_RATE_LIMITED", false], [400, "X_LIVE_CANARY_X_INVALID_REQUEST", false],
  [422, "X_LIVE_CANARY_X_INVALID_REQUEST", false], [418, "X_LIVE_CANARY_X_REJECTED", false],
  [500, "X_LIVE_CANARY_OUTCOME_UNKNOWN", true], [503, "X_LIVE_CANARY_OUTCOME_UNKNOWN", true],
  [302, "X_LIVE_CANARY_OUTCOME_UNKNOWN", true],
] as const) await assertProviderFailure(async () => new Response("RAW_PROVIDER_BODY_MARKER", { status }), code, uncertain)
await assertProviderFailure(async () => { throw new Error("RAW_EXCEPTION_MARKER") }, "X_LIVE_CANARY_NETWORK_FAILURE", true)
for (const name of ["TimeoutError", "AbortError"]) {
  const controller = new AbortController()
  if (name === "AbortError") controller.abort()
  await assertProviderFailure(async () => { throw Object.assign(new Error("RAW_EXCEPTION_MARKER"), { name }) }, "X_LIVE_CANARY_TIMEOUT", true, controller.signal)
}
{
  const nonAborted = new AbortController().signal
  await assertProviderFailure(async () => { throw Object.assign(new Error("RAW_EXCEPTION_MARKER"), { name: "AbortError" }) }, "X_LIVE_CANARY_NETWORK_FAILURE", true, nonAborted)
}

// Real route gate execution with a fresh poison body for every request.
function poisonRequest(url: string, confirmation?: string) {
  let reads = 0
  const body = { getReader() { reads++; throw new Error("RAW_EXCEPTION_MARKER") } } as any
  const headers = new Headers()
  if (confirmation !== undefined) headers.set(canary.X_LIVE_CANARY_CONFIRMATION_HEADER, confirmation)
  return { request: { url, headers, body } as Request, reads: () => reads }
}
const routeGateCases = [
  { name: "missing user", user: null, confirmation: canary.X_LIVE_CANARY_CONFIRMATION_VALUE, status: 401, code: "X_LIVE_CANARY_UNAUTHENTICATED", url: "https://local.invalid/api" },
  { name: "blank user", user: " ", confirmation: canary.X_LIVE_CANARY_CONFIRMATION_VALUE, status: 401, code: "X_LIVE_CANARY_UNAUTHENTICATED", url: "https://local.invalid/api" },
  { name: "missing confirmation", user: "AUTHENTICATED_USER_MARKER", confirmation: undefined, status: 400, code: "X_LIVE_CANARY_CONFIRMATION_REQUIRED", url: "https://local.invalid/api" },
  { name: "wrong confirmation", user: "AUTHENTICATED_USER_MARKER", confirmation: "wrong", status: 400, code: "X_LIVE_CANARY_CONFIRMATION_REQUIRED", url: "https://local.invalid/api" },
  { name: "query", user: "AUTHENTICATED_USER_MARKER", confirmation: canary.X_LIVE_CANARY_CONFIRMATION_VALUE, status: 400, code: "X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED", url: "https://local.invalid/api?q=1" },
]
for (const testCase of routeGateCases) {
  let adminCalls = 0
  let accountReads = 0
  routeHooks.requireUserId = async ({ request }: any) => {
    assert.ok(request)
    return testCase.user
  }
  routeHooks.getSupabaseAdmin = () => { adminCalls++; accountReads++; throw new Error("SERVICE_ROLE_MARKER") }
  const poison = poisonRequest(testCase.url, testCase.confirmation)
  const result: any = await route.POST(poison.request)
  assert.equal(result.status, testCase.status, testCase.name)
  assert.equal(result.body.safe_code, testCase.code, testCase.name)
  assert.equal(poison.reads(), 0, testCase.name)
  assert.equal(adminCalls, 0, testCase.name)
  assert.equal(accountReads, 0, testCase.name)
  assertSanitized(result.body)
}

// Real GET is method-locked, private/no-store, and performs no privileged work.
{
  let adminCalls = 0
  routeHooks.getSupabaseAdmin = () => { adminCalls++; throw new Error("SERVICE_ROLE_MARKER") }
  const result: any = route.GET()
  assert.equal(result.status, 405)
  assert.equal(result.body.safe_code, "X_LIVE_CANARY_METHOD_NOT_ALLOWED")
  assert.equal(result.headers.get("cache-control"), "private, no-store, max-age=0")
  assert.equal(adminCalls, 0)
  assertFixedFlags(result.body)
  assert.equal(route.runtime, "nodejs")
  assert.equal(route.dynamic, "force-dynamic")
}

// Body cancellation failures/stalls remain bounded and sanitized.
function bodyRequest(body: ReadableStream<Uint8Array>): Request {
  return {
    url: "https://local.invalid/api",
    headers: new Headers({ [canary.X_LIVE_CANARY_CONFIRMATION_HEADER]: canary.X_LIVE_CANARY_CONFIRMATION_VALUE }),
    body,
  } as Request
}
async function boundedBodyCase(body: ReadableStream<Uint8Array>) {
  let accountLoads = 0
  const value = harness()
  value.deps.loadAccount = async () => { accountLoads++; return validAccount }
  const operation = canary.handleXLiveTextCanaryRequest({
    ...value.deps,
    request: bodyRequest(body),
    getAuthenticatedUserId: async () => "AUTHENTICATED_USER_MARKER",
  })
  const result = await Promise.race([
    operation,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("outer timeout")), 1_000)),
  ])
  assert.equal(result.status, 400)
  assert.equal(result.body.safe_code, "X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED")
  assert.equal(accountLoads, 0)
  assert.equal(value.counters.timeoutCalls, 0)
  assert.equal(value.counters.fetchCalls, 0)
  assertSanitized(result.body)
}
const empty = () => new Uint8Array()
const byte = () => new Uint8Array([1])
const cancellationCases = [
  new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(byte()) }, cancel() { return Promise.reject(new Error("RAW_EXCEPTION_MARKER")) } }),
  new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(byte()) }, cancel() { return new Promise<void>(() => undefined) } }),
  new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < 9; i++) controller.enqueue(empty()) }, cancel() { return Promise.reject(new Error("RAW_EXCEPTION_MARKER")) } }),
  new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < 9; i++) controller.enqueue(empty()) }, cancel() { return new Promise<void>(() => undefined) } }),
  new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("RAW_EXCEPTION_MARKER")) }, cancel() { return Promise.reject(new Error("RAW_EXCEPTION_MARKER")) } }),
  new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("RAW_EXCEPTION_MARKER")) }, cancel() { return new Promise<void>(() => undefined) } }),
]
for (const body of cancellationCases) await boundedBodyCase(body)

// Timer cleanup is proven by tracking every helper-created timeout handle.
async function withTrackedTimers<T>(operation: () => Promise<T>) {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const active = new Set<any>()
  globalThis.setTimeout = ((handler: any, timeout?: number, ...args: any[]) => {
    const handle = originalSetTimeout(() => { active.delete(handle); handler(...args) }, timeout)
    active.add(handle)
    return handle
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle: any) => { active.delete(handle); return originalClearTimeout(handle) }) as typeof clearTimeout
  try { await operation(); assert.equal(active.size, 0) }
  finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout }
}
await withTrackedTimers(async () => {
  const closed = new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
  assert.equal(await canary.hasXLiveCanaryRequestBody(bodyRequest(closed)), false)
})
await withTrackedTimers(async () => {
  const finite = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(empty()); controller.close() } })
  assert.equal(await canary.hasXLiveCanaryRequestBody(bodyRequest(finite)), false)
})
await withTrackedTimers(async () => {
  const nonempty = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(byte()) } })
  assert.equal(await canary.hasXLiveCanaryRequestBody(bodyRequest(nonempty)), true)
})
await withTrackedTimers(async () => {
  const failure = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("RAW_EXCEPTION_MARKER")) } })
  await assert.rejects(canary.hasXLiveCanaryRequestBody(bodyRequest(failure)))
})
await withTrackedTimers(async () => {
  const stalled = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => undefined) }, cancel() { return Promise.resolve() } })
  await assert.rejects(canary.hasXLiveCanaryRequestBody(bodyRequest(stalled)))
})
await withTrackedTimers(async () => {
  const stalledCancel = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(byte()) }, cancel() { return new Promise<void>(() => undefined) } })
  assert.equal(await canary.hasXLiveCanaryRequestBody(bodyRequest(stalledCancel)), true)
})

// The normal adapter retains its outward response and never exposes low-level failure_kind.
function normalAdapterDeps(fetchImpl: Fetch) {
  const builder: any = {
    select() { return this }, eq() { return this },
    async maybeSingle() {
      return { data: { encrypted_access_token: "encrypted", encrypted_refresh_token: "refresh", token_expires_at: "2035-01-01T00:00:00Z", token_type: "Bearer", token_key_version: 7, provider_username: "name", provider_account_id: "id" }, error: null }
    },
  }
  return { supabaseAdmin: { from: () => builder } as any, decryptToken: () => "token", now: () => new Date(NOW), fetchImpl, getApiBaseUrl: () => "https://api.x.com" }
}
async function normal(fetchImpl: Fetch) {
  const result: any = await adapter.postXTextOnlyAutopost({ run_mode: "autopost", user_id: "user", rule_id: "rule", payload: { text: "text" } }, normalAdapterDeps(fetchImpl))
  assert.equal("failure_kind" in result, false)
  return result
}
{
  const result = await normal(async (_url, init) => {
    assert.equal(init?.signal, undefined)
    return new Response(JSON.stringify({ data: { id: "normal-id" } }), { status: 201 })
  })
  assert.deepEqual({ ok: result.ok, status: result.status, platform: result.platform, platform_post_id: result.platform_post_id }, { ok: true, status: "POSTED", platform: "x", platform_post_id: "normal-id" })
}
for (const [status, code] of [[401, "X_API_UNAUTHORIZED"], [403, "X_API_FORBIDDEN"], [429, "X_API_RATE_LIMITED"], [400, "X_API_INVALID_REQUEST"], [422, "X_API_INVALID_REQUEST"], [418, "X_API_REJECTED"]] as const) {
  assert.equal((await normal(async () => new Response("body", { status }))).error_code, code)
}
assert.equal((await normal(async () => { throw new Error("network") })).error_code, "X_POST_OUTCOME_UNKNOWN")
assert.equal((await normal(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }) })).error_code, "X_POST_OUTCOME_UNKNOWN")
assert.equal((await normal(async () => new Response("body", { status: 500 }))).error_code, "X_POST_OUTCOME_UNKNOWN")
assert.equal((await normal(async () => ({ ok: true, status: 201, json: async () => { throw new Error("invalid") } }) as Response)).error_code, "X_POST_OUTCOME_UNKNOWN")
for (const body of [{}, { data: {} }, { data: { id: " " } }]) {
  assert.equal((await normal(async () => ({ ok: true, status: 201, json: async () => body }) as Response)).error_code, "X_POST_OUTCOME_UNKNOWN")
}

// Public X and dispatch locks remain explicit; no route is wired into product or deployment files.
const previousDispatch = process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED
try {
  process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = "false"
  assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED, "false")
  const xRegistry = registry.getAutopostPlatformRegistry().find((entry: any) => entry.id === "x")
  assert.equal(xRegistry.launch_status, "coming_soon")
  assert.equal(xRegistry.public_selectable, false)
  const status = availability.buildUserPlatformStatus(xRegistry, new Map([["x", validAccount]]) as any)
  assert.equal(status.public_selectable, false)
  assert.equal(status.can_schedule, false)
} finally {
  if (previousDispatch === undefined) delete process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED
  else process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = previousDispatch
}
for (const path of ["vercel.json", "app/autopost/AutopostPageClient.tsx", "app/api/autopost/run/route.ts"]) {
  const source = readFileSync(path, "utf8")
  assert.equal(source.includes("/api/admin/autopost/x/live-text-canary"), false, path)
}
const vercel = readFileSync("vercel.json", "utf8")
assert.equal(/live-text-canary|\/2\/tweets/i.test(vercel), false)

// Source-level dependency and compatibility contracts.
const canarySource = readFileSync("lib/autopost/xLiveTextCanary.ts", "utf8")
const postureSource = readFileSync("lib/autopost/xStoredPosture.ts", "utf8")
const availabilitySource = readFileSync("lib/autopost/platformAvailability.ts", "utf8")
assert.ok(canarySource.includes('from "./xStoredPosture"'))
assert.equal(canarySource.includes('from "./platformAvailability"'), false)
assert.equal(/fanvue|platformAvailability|process\.env|supabase|tokenCrypto|providerClient|runner|scheduler/i.test(postureSource), false)
assert.ok(availabilitySource.includes('export { getXStoredPostureBlocker } from "./xStoredPosture"'))
assert.ok(availabilitySource.includes('export type { XStoredPostureAccount, XStoredPostureBlocker } from "./xStoredPosture"'))
for (const source of [canarySource, readFileSync("app/api/admin/autopost/x/live-text-canary/route.ts", "utf8")]) {
  for (const prohibited of ["refreshXAccessToken", "postXTextOnlyAutopost", ".update(", ".upsert(", ".insert(", ".delete(", ".rpc(", "console.log", "console.error"]) assert.equal(source.includes(prohibited), false, prohibited)
}
assert.equal(canary.X_LIVE_CANARY_TIMEOUT_MS, 10_000)
assert.equal(adapter.X_TOKEN_EXPIRY_REFRESH_BUFFER_MS, 60_000)

console.log("X live text canary correction tests passed with deterministic fakes; no provider or Production action occurred.")
