import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

const emptyServerOnly = "data:text/javascript,export%20{}"
const nextServer = `data:text/javascript,${encodeURIComponent(`
class MockResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.headers = init.headers ?? {}; this.cookiesSet = []; this.cookies = { set: value => this.cookiesSet.push(value) } }
  static json(body, init) { return new MockResponse(body, init) }
  static redirect(url) { const response = new MockResponse(null, { status: 307 }); response.location = url.toString(); return response }
}
export { MockResponse as NextResponse }
`)}`
const supabaseServer = `data:text/javascript,${encodeURIComponent(`export const requireUserId = input => globalThis.__xTest.requireUserId(input)`)}`
const supabaseAdmin = `data:text/javascript,${encodeURIComponent(`export const getSupabaseAdmin = () => globalThis.__xTest.getSupabaseAdmin()`)}`
const tokenCrypto = `data:text/javascript,${encodeURIComponent(`export const encryptAutopostToken = value => globalThis.__xTest.encryptToken(value); export const getAutopostTokenKeyVersion = () => globalThis.__xTest.getKeyVersion()`)}`
const nextHeaders = `data:text/javascript,${encodeURIComponent(`export const cookies = () => globalThis.__xTest.cookies()`)}`
const initialCallback = `data:text/javascript,${encodeURIComponent(`export const completeInitialXOAuthConnection = input => globalThis.__xTest.completeInitial(input)`)}`
const reauthCallback = `data:text/javascript,${encodeURIComponent(`export const completeXReauthorization = input => globalThis.__xTest.completeReauth(input)`)}`
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnly)}, shortCircuit: true }
  if (specifier === 'next/server') return { url: ${JSON.stringify(nextServer)}, shortCircuit: true }
  if (specifier === 'next/headers') return { url: ${JSON.stringify(nextHeaders)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseServer') return { url: ${JSON.stringify(supabaseServer)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseAdmin') return { url: ${JSON.stringify(supabaseAdmin)}, shortCircuit: true }
  if (specifier === '@/lib/autopost/tokenCrypto') return { url: ${JSON.stringify(tokenCrypto)}, shortCircuit: true }
  if (context.parentURL?.includes('/app/api/autopost/connect/x/callback/route.ts') && specifier === '@/lib/autopost/xInitialOAuthCallback') return { url: ${JSON.stringify(initialCallback)}, shortCircuit: true }
  if (context.parentURL?.includes('/app/api/autopost/connect/x/callback/route.ts') && specifier === '@/lib/autopost/xReauthorizationCallback') return { url: ${JSON.stringify(reauthCallback)}, shortCircuit: true }
  return nextResolve(specifier, context)
}`)}`, import.meta.url)

type Hooks = Record<string, any>
const hooks: Hooks = {}
;(globalThis as any).__xTest = hooks
process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED = "false"
hooks.encryptToken = (value: string) => `default-encrypted-${value}`
hooks.getKeyVersion = () => 1
hooks.getSupabaseAdmin = () => { throw new Error("unexpected privileged client") }

const oauth = await import("../../../lib/autopost/xOAuth")
const { completeXReauthorization } = await import("../../../lib/autopost/xReauthorizationCallback")
const startRoute = await import("../../../app/api/admin/autopost/x/reauthorize/route")
const callbackRoute = await import("../../../app/api/autopost/connect/x/callback/route")

const USER = "fake-user", ID = "fake-existing-provider-id", USERNAME = "Fake_Existing_User"
const ACCESS = "FAKE_ACCESS_TOKEN_MARKER", REFRESH = "FAKE_REFRESH_TOKEN_MARKER"
const SECRET = "FAKE_CLIENT_SECRET_MARKER", CODE = "FAKE_AUTHORIZATION_CODE_MARKER", VERIFIER = "FAKE_PKCE_VERIFIER_MARKER"
const RAW = "FAKE_RAW_PROVIDER_RESPONSE_MARKER", DB_ERROR = "FAKE_RAW_DATABASE_ERROR_MARKER", EXCEPTION = "FAKE_EXCEPTION_TEXT_MARKER"
const ENCRYPTED_ACCESS = "FAKE_ENCRYPTED_ACCESS_MARKER", ENCRYPTED_REFRESH = "FAKE_ENCRYPTED_REFRESH_MARKER"
const NOW = new Date("2026-07-25T00:00:00.000Z")
const ENV = { X_CLIENT_ID: "FAKE_CLIENT_ID", X_CLIENT_SECRET: SECRET, X_REDIRECT_URI: "https://callback.invalid/x" }
const validToken = (extra: Record<string, unknown> = {}) => ({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: "Bearer", scope: "users.read  users.read offline.access", ...extra })
const validIdentity = (extra: Record<string, unknown> = {}) => ({ data: { id: ID, username: "fake_existing_user", name: "Fake Display", ...extra } })
const response = (body: unknown, options: { ok?: boolean; jsonThrow?: boolean } = {}) => ({ ok: options.ok ?? true, json: async () => { if (options.jsonThrow) throw new Error(EXCEPTION); return body } } as Response)

function assertSanitized(result: unknown) {
  const serialized = JSON.stringify(result)
  for (const marker of [ACCESS, REFRESH, ENCRYPTED_ACCESS, ENCRYPTED_REFRESH, SECRET, CODE, VERIFIER, ID, USERNAME, RAW, DB_ERROR, EXCEPTION]) assert.ok(!serialized.includes(marker), marker)
}
function assertFlags(result: any, provider: boolean, identity: boolean, write: boolean, ok = false) {
  assert.equal(result.ok, ok); assert.equal(result.provider_request_attempted, provider); assert.equal(result.identity_request_attempted, identity); assert.equal(result.database_write_attempted, write)
  for (const key of ["refresh_attempted", "retry_attempted", "disconnect_attempted", "post_attempted", "fanvue_account_queried", "fanvue_account_mutated"]) assert.equal(result[key], false, key)
  assertSanitized(result)
}

// A. Start route: execute the real handler with deterministic server fakes.
function accountClient(data: unknown, error: unknown = null) {
  const calls: any[] = []
  const client = { from(table: string) { calls.push(["from", table]); return { select(columns: string) { calls.push(["select", columns]); const chain = { eq(column: string, value: unknown) { calls.push(["eq", column, value]); return chain }, async maybeSingle() { calls.push(["maybeSingle"]); return { data, error } } }; return chain } } } }
  return { client, calls }
}
async function start(input: { user?: unknown; confirmation?: string; url?: string; body?: string; data?: unknown; error?: unknown }) {
  let adminCalls = 0
  const fake = accountClient(input.data === undefined ? { connection_status: "CONNECTED", provider_account_id: ID, provider_username: USERNAME } : input.data, input.error)
  hooks.requireUserId = async () => input.user
  hooks.getSupabaseAdmin = () => { adminCalls++; return fake.client }
  const headers = new Headers(); if (input.confirmation !== undefined) headers.set("x-autopost-x-reauthorize", input.confirmation)
  const req = new Request(input.url ?? "https://app.invalid/api/admin/autopost/x/reauthorize", { method: "POST", headers, ...(input.body === undefined ? {} : { body: input.body }) })
  const result: any = await startRoute.POST(req)
  return { result, adminCalls, calls: fake.calls }
}
process.env.AUTOPOST_OAUTH_STATE_SECRET = "fake-state-secret"
process.env.X_CLIENT_ID = "fake-client-id"
process.env.X_REDIRECT_URI = "https://app.invalid/api/autopost/connect/x/callback"
for (const [input, status] of [
  [{ user: null, confirmation: "preserve-existing-x-identity-v1" }, 401], [{ user: "   ", confirmation: "preserve-existing-x-identity-v1" }, 401],
  [{ user: USER }, 400], [{ user: USER, confirmation: "wrong" }, 400],
  [{ user: USER, confirmation: "preserve-existing-x-identity-v1", url: "https://app.invalid/api/admin/autopost/x/reauthorize?x=1" }, 400],
  [{ user: USER, confirmation: "preserve-existing-x-identity-v1", body: "{}" }, 400],
] as const) { const value = await start(input); assert.equal(value.result.status, status); assert.equal(value.adminCalls, 0); assertSanitized(value.result.body) }
{
  let adminCalls = 0; hooks.getSupabaseAdmin = () => { adminCalls++; throw new Error(EXCEPTION) }
  const get: any = await startRoute.GET(); assert.equal(get.status, 405); assert.equal(adminCalls, 0); assert.equal(get.body.safe_code, "X_REAUTH_START_METHOD_NOT_ALLOWED")
}
{
  const value = await start({ user: USER, confirmation: "preserve-existing-x-identity-v1", error: { marker: DB_ERROR } }); assert.equal(value.result.body.safe_code, "X_REAUTH_START_ACCOUNT_LOOKUP_FAILED"); assertSanitized(value.result.body)
}
for (const data of [null, { connection_status: "DISCONNECTED", provider_account_id: ID, provider_username: USERNAME }, { connection_status: "CONNECTED", provider_account_id: " ", provider_username: USERNAME }, { connection_status: "CONNECTED", provider_account_id: ID, provider_username: " " }]) {
  const value = await start({ user: USER, confirmation: "preserve-existing-x-identity-v1", data }); assert.equal(value.result.body.safe_code, "X_REAUTH_START_ACCOUNT_NOT_READY")
}
{
  const value = await start({ user: USER, confirmation: "preserve-existing-x-identity-v1" }); assert.equal(value.result.status, 200); assert.equal(value.result.body.safe_code, "X_REAUTH_START_READY")
  assert.deepEqual(value.calls, [["from", "autopost_accounts"], ["select", "connection_status, provider_account_id, provider_username"], ["eq", "user_id", USER], ["eq", "platform", "x"], ["maybeSingle"]])
  assert.deepEqual(Object.keys(value.result.body).sort(), ["authorization_url", "database_write_attempted", "disconnect_attempted", "fanvue_account_mutated", "fanvue_account_queried", "mode", "oauth_token_exchange_attempted", "ok", "post_attempted", "provider_request_attempted", "read_only", "reconnect_completed", "refresh_attempted", "retry_attempted", "safe_code"].sort())
  assert.ok(value.result.body.authorization_url.startsWith("https://x.com/i/oauth2/authorize?")); assert.ok(!value.result.body.authorization_url.includes(ID)); assert.ok(!value.result.body.authorization_url.includes(USERNAME)); assert.equal(value.result.cookiesSet.length, 1); assert.equal(value.result.cookiesSet[0].httpOnly, true); assertSanitized(value.result.body)
}

// B. Signed OAuth state behavior.
const initial = oauth.createXOAuthState(USER); assert.equal(oauth.verifySignedXOAuthCookie(initial.cookieValue).flow, "initial")
const basePayload = { provider: "x" as const, user_id: USER, state_hash: "hash", code_verifier: VERIFIER, created_at: NOW.toISOString(), expires_at: "2099-01-01T00:00:00.000Z" }
assert.equal(oauth.verifySignedXOAuthCookie(oauth.createSignedXOAuthCookie(basePayload)).flow, "initial")
const reauth = oauth.createXReauthorizationOAuthState(USER, ID, USERNAME), decoded = oauth.verifySignedXOAuthCookie(reauth.cookieValue)
assert.equal(decoded.flow, "reauthorize"); assert.equal(decoded.expected_provider_account_id, ID); assert.equal(decoded.expected_provider_username, USERNAME)
const authorize = oauth.buildXAuthorizeUrl({ state: reauth.state, codeChallenge: reauth.codeChallenge }).toString(); assert.ok(!authorize.includes(ID)); assert.ok(!authorize.includes(USERNAME))
for (const args of [["", ID, USERNAME], [USER, " ", USERNAME], [USER, ID, " "]] as const) assert.throws(() => oauth.createXReauthorizationOAuthState(...args))
for (const payload of [
  { ...basePayload, flow: "unknown" }, { ...basePayload, flow: "reauthorize" }, { ...basePayload, flow: "reauthorize", expected_provider_account_id: ID }, { ...basePayload, flow: "reauthorize", expected_provider_username: USERNAME },
  { ...basePayload, provider: "fanvue" }, { ...basePayload, expires_at: "2000-01-01T00:00:00.000Z" },
]) assert.throws(() => oauth.verifySignedXOAuthCookie(oauth.createSignedXOAuthCookie(payload as any)))
assert.throws(() => oauth.verifySignedXOAuthCookie(reauth.cookieValue.slice(0, -1) + "x"))

// C. Real callback branching with injected completion functions and cookie store.
async function callback(payload: any, query: string, user: unknown = USER, cookiePresent = true) {
  const calls: string[] = []; hooks.requireUserId = async () => user; hooks.completeInitial = async () => { calls.push("initial"); return { ok: true } }; hooks.completeReauth = async () => { calls.push("reauthorize"); return { ok: true, safe_code: "X_REAUTH_SUCCEEDED" } }
  const cookieValue = oauth.createSignedXOAuthCookie(payload); hooks.cookies = async () => ({ get: () => cookiePresent ? { value: cookieValue } : undefined })
  const result: any = await callbackRoute.GET(new Request(`https://app.invalid/api/autopost/connect/x/callback?${query}`)); return { result, calls }
}
const callbackPayload = { ...basePayload, state_hash: oauth.sha256Base64Url("returned"), flow: "reauthorize", expected_provider_account_id: ID, expected_provider_username: USERNAME }
for (const [payload, expected] of [[callbackPayload, "reauthorize"], [{ ...callbackPayload, flow: "initial", expected_provider_account_id: undefined, expected_provider_username: undefined }, "initial"], [{ ...basePayload, state_hash: oauth.sha256Base64Url("returned") }, "initial"]] as const) {
  const value = await callback(payload, "code=fake&state=returned"); assert.deepEqual(value.calls, [expected]); assert.equal(value.result.cookiesSet.at(-1).maxAge, 0)
}
for (const scenario of [
  [callbackPayload, "error=access_denied", USER, true], [callbackPayload, "state=returned", USER, true], [callbackPayload, "code=fake&state=returned", USER, false], [callbackPayload, "code=fake&state=returned", "other-user", true], [callbackPayload, "code=fake&state=wrong", USER, true],
] as const) { const value = await callback(scenario[0], scenario[1], scenario[2], scenario[3]); assert.deepEqual(value.calls, []); assert.equal(value.result.cookiesSet.at(-1).maxAge, 0); assertSanitized({ body: value.result.body, location: value.result.location }) }

// D-J. Helper behavioral harness.
type Options = { account?: any; lookupError?: unknown; env?: Record<string, string | undefined>; token?: any; tokenResponse?: Response; tokenThrow?: boolean; identity?: any; identityResponse?: Response; identityThrow?: boolean; encryptThrow?: number; keyThrow?: boolean; adminThrow?: boolean; updateData?: unknown; updateError?: unknown; updateThrow?: boolean }
function helperHarness(options: Options = {}) {
  const events: string[] = [], requests: { url: string; init?: RequestInit }[] = [], filters: any[] = [], writes: any[] = [], forbidden: string[] = []
  let encryptCount = 0
  const deps = {
    env: options.env ?? ENV, now: () => NOW, getApiBaseUrl: () => "https://api.x.invalid",
    readCurrentAccount: async (userId: string) => { events.push(`read:${userId}:x`); return { data: options.account === undefined ? { connection_status: "CONNECTED", provider_account_id: ID, provider_username: USERNAME, metadata: { retained: "yes" } } : options.account, error: options.lookupError ?? null } },
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => { const target = String(url); requests.push({ url: target, init }); events.push(target.endsWith("/2/oauth2/token") ? "token" : "identity"); if (requests.length === 1) { if (options.tokenThrow) throw new Error(EXCEPTION); return options.tokenResponse ?? response(options.token ?? validToken()) } if (options.identityThrow) throw new Error(EXCEPTION); return options.identityResponse ?? response(options.identity ?? validIdentity()) },
    encryptToken: (value: string) => { events.push("encrypt"); if (++encryptCount === options.encryptThrow) throw new Error(EXCEPTION); return value === ACCESS ? ENCRYPTED_ACCESS : ENCRYPTED_REFRESH },
    getTokenKeyVersion: () => { events.push("key"); if (options.keyThrow) throw new Error(EXCEPTION); return 9 },
    getSupabaseAdmin: () => {
      events.push("admin")
      if (options.adminThrow) throw new Error(EXCEPTION)
      return {
        from(table: string) {
          events.push(`from:${table}`)
          return {
            upsert() { forbidden.push("upsert") }, insert() { forbidden.push("insert") },
            delete() { forbidden.push("delete") }, rpc() { forbidden.push("rpc") },
            update(value: any) {
              writes.push(value); events.push("update")
              if (options.updateThrow) throw new Error(EXCEPTION)
              const chain = {
                eq(column: string, value: unknown) { filters.push([column, value]); return chain },
                async select(columns: string) { events.push(`select:${columns}`); return { data: options.updateData === undefined ? [{ id: "fake-row" }] : options.updateData, error: options.updateError ?? null } },
              }
              return chain
            },
          }
        },
      } as any
    },
  }
  const run = (override: Record<string, string> = {}) => completeXReauthorization({ userId: USER, code: CODE, codeVerifier: VERIFIER, expectedProviderAccountId: ID, expectedProviderUsername: USERNAME, ...override }, deps)
  return { run, events, requests, filters, writes, forbidden }
}
for (const options of [
  { lookupError: { marker: DB_ERROR } }, { account: null }, { account: { connection_status: "DISCONNECTED", provider_account_id: ID, provider_username: USERNAME } }, { account: { connection_status: "CONNECTED", provider_account_id: " ", provider_username: USERNAME } }, { account: { connection_status: "CONNECTED", provider_account_id: ID, provider_username: " " } }, { account: { connection_status: "CONNECTED", provider_account_id: "changed", provider_username: USERNAME } }, { account: { connection_status: "CONNECTED", provider_account_id: ID, provider_username: "changed" } },
]) { const h = helperHarness(options), result = await h.run(); assert.ok(["X_REAUTH_ACCOUNT_NOT_READY", "X_REAUTH_ACCOUNT_CHANGED"].includes(result.safe_code)); assert.equal(h.requests.length, 0); assertFlags(result, false, false, false) }
for (const key of ["userId", "code", "codeVerifier", "expectedProviderAccountId", "expectedProviderUsername"]) { const h = helperHarness(), result = await h.run({ [key]: " " }); assert.equal(result.safe_code, "X_REAUTH_STATE_IDENTITY_INVALID"); assertFlags(result, false, false, false) }
{
  const h = helperHarness(), result = await h.run(); assert.equal(result.safe_code, "X_REAUTH_SUCCEEDED"); assertFlags(result, true, true, true, true)
  assert.equal(h.requests.length, 2); const tokenRequest = h.requests[0], identityRequest = h.requests[1]; assert.ok(tokenRequest.url.endsWith("/2/oauth2/token")); assert.equal(tokenRequest.init?.method, "POST"); assert.equal((tokenRequest.init?.headers as any).authorization, `Basic ${Buffer.from(`FAKE_CLIENT_ID:${SECRET}`).toString("base64")}`); assert.equal((tokenRequest.init?.headers as any)["content-type"], "application/x-www-form-urlencoded")
  const body = new URLSearchParams(String(tokenRequest.init?.body)); assert.equal(body.get("code"), CODE); assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("redirect_uri"), ENV.X_REDIRECT_URI); assert.equal(body.get("code_verifier"), VERIFIER); assert.ok(!String(tokenRequest.init?.body).includes(ACCESS) && !String(tokenRequest.init?.body).includes(REFRESH))
  assert.ok(identityRequest.url.endsWith("/2/users/me")); assert.equal(identityRequest.init?.method, "GET"); assert.equal((identityRequest.init?.headers as any).authorization, `Bearer ${ACCESS}`); assert.equal(identityRequest.init?.body, undefined)
  assert.deepEqual(h.filters, [["user_id", USER], ["platform", "x"], ["provider_account_id", ID], ["provider_username", USERNAME], ["connection_status", "CONNECTED"]]); assert.deepEqual(h.forbidden, [])
  const update = h.writes[0]; assert.deepEqual(Object.keys(update).sort(), ["provider_username", "display_name", "token_type", "scopes", "encrypted_access_token", "encrypted_refresh_token", "token_key_version", "token_expires_at", "connection_status", "last_refresh_at", "last_error", "metadata"].sort()); assert.equal(update.provider_username, USERNAME); assert.deepEqual(update.scopes, ["users.read", "offline.access"]); assert.equal(update.metadata.retained, "yes"); assert.equal(update.metadata.reauthorized, true)
  for (const preserved of ["id", "user_id", "platform", "provider_account_id", "connected_at", "created_at", "access_token", "refresh_token"]) assert.ok(!(preserved in update))
}
// Token failures and explicit invalid scopes.
for (const options of [
  { env: { ...ENV, X_CLIENT_ID: " " } }, { env: { ...ENV, X_CLIENT_SECRET: " " } }, { env: { ...ENV, X_REDIRECT_URI: " " } }, { tokenThrow: true }, { tokenResponse: response({}, { ok: false }) }, { tokenResponse: response({}, { jsonThrow: true }) }, { token: [] }, { token: validToken({ access_token: " " }) }, { token: validToken({ refresh_token: null }) }, { token: validToken({ expires_in: 0 }) }, { token: validToken({ token_type: "mac" }) }, { token: validToken({ scope: null }) }, { token: validToken({ scope: " " }) },
]) { const h = helperHarness(options), result = await h.run(); assert.ok(["X_REAUTH_TOKEN_EXCHANGE_FAILED", "X_REAUTH_TOKEN_RESPONSE_INVALID"].includes(result.safe_code)); assert.equal(h.requests.filter(r => r.url.endsWith("/2/oauth2/token")).length <= 1, true); assert.equal(h.requests.some(r => r.url.endsWith("/2/users/me")), false); assertFlags(result, h.requests.length === 1, false, false) }
// Scope omission uses configured then default fallback and still performs only two provider attempts.
for (const [configured, expected] of [[" users.read users.read offline.access ", ["users.read", "offline.access"]], [undefined, ["tweet.read", "tweet.write", "users.read", "offline.access"]]] as const) {
  const tokenWithoutScope: any = validToken(); delete tokenWithoutScope.scope; const h = helperHarness({ token: tokenWithoutScope, env: { ...ENV, ...(configured === undefined ? {} : { X_OAUTH_SCOPES: configured }) } }); const result = await h.run(); assert.equal(result.safe_code, "X_REAUTH_SUCCEEDED"); assert.deepEqual(h.writes[0].scopes, expected); assert.equal(h.requests.length, 2)
}
// Identity failures and identity-lock no-encryption guarantees.
for (const options of [
  { identityThrow: true }, { identityResponse: response({}, { ok: false }) }, { identityResponse: response({}, { jsonThrow: true }) }, { identity: [] }, { identity: {} }, { identity: { data: { id: " ", username: USERNAME } } }, { identity: { data: { id: ID, username: " " } } }, { identity: validIdentity({ id: "different" }) }, { identity: validIdentity({ username: "different" }) },
]) { const h = helperHarness(options), result = await h.run(); assert.ok(result.safe_code.startsWith("X_REAUTH_IDENTITY_") || result.safe_code.endsWith("MISMATCH")); assert.equal(h.requests.length, 2); assert.ok(!h.events.includes("encrypt") && !h.events.includes("admin") && !h.events.includes("update")); assertFlags(result, true, true, false) }
for (const identity of [validIdentity({ username: USERNAME.toUpperCase() }), { data: { id: ID, username: USERNAME } }]) { const h = helperHarness({ identity }), result = await h.run(); assert.equal(result.safe_code, "X_REAUTH_SUCCEEDED") }
for (const [options, code] of [[{ encryptThrow: 1 }, "X_REAUTH_TOKEN_ENCRYPTION_FAILED"], [{ encryptThrow: 2 }, "X_REAUTH_TOKEN_ENCRYPTION_FAILED"], [{ keyThrow: true }, "X_REAUTH_TOKEN_ENCRYPTION_FAILED"], [{ adminThrow: true }, "X_REAUTH_ACCOUNT_UPDATE_FAILED"]] as const) { const h = helperHarness(options), result = await h.run(); assert.equal(result.safe_code, code); assert.ok(!h.events.includes("update")); assertFlags(result, true, true, false) }
for (const [options, code] of [[{ updateData: [] }, "X_REAUTH_ACCOUNT_CHANGED"], [{ updateData: [{}, {}] }, "X_REAUTH_ACCOUNT_CHANGED"], [{ updateError: { marker: DB_ERROR } }, "X_REAUTH_ACCOUNT_UPDATE_FAILED"], [{ updateThrow: true }, "X_REAUTH_ACCOUNT_UPDATE_FAILED"]] as const) { const h = helperHarness(options), result = await h.run(); assert.equal(result.safe_code, code); assertFlags(result, true, true, true) }

// K. Product locks and isolation are repository contracts; helper/start behavior above proves X-only access.
const helperSource = readFileSync("lib/autopost/xReauthorizationCallback.ts", "utf8"), startSource = readFileSync("app/api/admin/autopost/x/reauthorize/route.ts", "utf8"), registry = readFileSync("lib/autopost/platformRegistry.ts", "utf8"), availability = readFileSync("lib/autopost/platformAvailability.ts", "utf8"), vercel = readFileSync("vercel.json", "utf8")
assert.ok(!helperSource.includes("fanvueApi") && !helperSource.includes('platform", "fanvue"')); assert.ok(!startSource.includes('platform", "fanvue"')); assert.ok(!helperSource.includes("runner") && !helperSource.includes("cron") && !helperSource.includes("post(")); assert.ok(!startSource.includes("fetch("))
const xEntry = registry.slice(registry.indexOf('id: "x"'), registry.indexOf('id: "reddit"')); assert.match(xEntry, /public_selectable:\s*false/); assert.match(availability, /can_schedule:\s*false/); assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED, "false"); assert.ok(!vercel.includes("reauthorize"))
console.log("xReauthorizationIdentityLock tests passed: deterministic injected fakes only; no Production, X, Fanvue, OAuth, database, runner, dispatch, cron, diagnostic, or post action occurred")
