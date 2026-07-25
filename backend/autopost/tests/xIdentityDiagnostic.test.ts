import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

register(`data:text/javascript,export async function resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,export default {}',shortCircuit:true}:n(s,c)}`)

const diagnostic = await import("../../../lib/autopost/xIdentityDiagnostic.ts")
const { getXStoredPostureBlocker } = await import("../../../lib/autopost/platformAvailability.ts")
const {
  X_IDENTITY_DIAGNOSTIC_CONFIRMATION_HEADER: HEADER,
  X_IDENTITY_DIAGNOSTIC_CONFIRMATION_VALUE: CONFIRM,
  createXIdentityDiagnosticAccountLoader, handleXIdentityDiagnosticRequest, runXIdentityDiagnostic,
} = diagnostic

const account = {
  connection_status: "CONNECTED", provider_account_id: " provider-id ", provider_username: " Fake_Handle ",
  last_error: null, encrypted_access_token: "encrypted-access-marker", encrypted_refresh_token: "encrypted-refresh-marker",
  token_expires_at: "2020-01-01T00:00:00.000Z", token_key_version: 7,
  metadata: { provider: "x", identity_fetched: true },
}

function deps(overrides: Record<string, unknown> = {}) {
  let calls = 0
  const value = {
    loadAccount: async () => structuredClone(account), getTokenKeyVersion: () => 7,
    decryptToken: () => "  fake-decrypted-token  ", getApiBaseUrl: () => "https://api.x.invalid/base",
    createTimeoutSignal: () => new AbortController().signal,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      calls++
      assert.equal(String(url), "https://api.x.invalid/2/users/me")
      assert.deepEqual(init, { method: "GET", headers: { Authorization: "Bearer fake-decrypted-token" }, cache: "no-store", redirect: "error", signal: init?.signal })
      assert.ok(init?.signal)
      assert.equal("body" in (init ?? {}), false)
      return new Response(JSON.stringify({ data: { id: "provider-id", username: "fake_handle" } }), { status: 200 })
    }, ...overrides,
  }
  return { value: value as any, calls: () => calls }
}

{
  const operations: unknown[] = []
  const builder: any = { select(value: string) { operations.push(["select", value]); return this }, eq(key: string, value: string) { operations.push(["eq", key, value]); return this }, async maybeSingle() { operations.push(["maybeSingle"]); return { data: account, error: null } } }
  const client: any = { from(table: string) { operations.push(["from", table]); return builder } }
  const loaded = await createXIdentityDiagnosticAccountLoader(client)("session-user")
  assert.deepEqual(loaded, account)
  assert.deepEqual(operations, [["from", "autopost_accounts"], ["select", "connection_status, provider_account_id, provider_username, last_error, encrypted_access_token, encrypted_refresh_token, token_expires_at, token_key_version, metadata"], ["eq", "user_id", "session-user"], ["eq", "platform", "x"], ["maybeSingle"]])
}

const blockerCases: Array<[string, Partial<typeof account> | null]> = [
  ["X_ACCOUNT_NOT_CONNECTED", null], ["X_ACCOUNT_STATUS_DISCONNECTED", { connection_status: "DISCONNECTED" }],
  ["X_ACCOUNT_STATUS_EXPIRED", { connection_status: "EXPIRED" }], ["X_ACCOUNT_STATUS_REVOKED", { connection_status: "REVOKED" }],
  ["X_ACCOUNT_STATUS_ERROR", { connection_status: "ERROR" }], ["X_ACCOUNT_STATUS_UNKNOWN", { connection_status: "OTHER" }],
  ["X_PROVIDER_ACCOUNT_ID_MISSING", { provider_account_id: " " }], ["X_PROVIDER_USERNAME_MISSING", { provider_username: " " }],
  ["X_ENCRYPTED_ACCESS_TOKEN_MISSING", { encrypted_access_token: "" }], ["X_ENCRYPTED_REFRESH_TOKEN_MISSING", { encrypted_refresh_token: "" }],
  ["X_TOKEN_EXPIRY_INVALID", { token_expires_at: "bad" }], ["X_TOKEN_KEY_VERSION_INVALID", { token_key_version: 0 }],
  ["X_PROVIDER_METADATA_MISSING", { metadata: { provider: "other", identity_fetched: true } }],
  ["X_IDENTITY_NOT_CONFIRMED", { metadata: { provider: "x", identity_fetched: false } }], ["X_ACCOUNT_ERROR_PRESENT", { last_error: "raw-last-error" }],
]
for (const [expected, patch] of blockerCases) {
  const row = patch === null ? null : { ...structuredClone(account), ...patch }
  assert.equal(getXStoredPostureBlocker(row), expected)
  const fixture = JSON.stringify(row), d = deps({ loadAccount: async () => row })
  const out = await runXIdentityDiagnostic("session-user", d.value)
  assert.equal(out.safe_code, "X_IDENTITY_DIAGNOSTIC_ACCOUNT_NOT_READY"); assert.equal(out.stored_posture_blocker, expected)
  assert.equal(d.calls(), 0); assert.equal(JSON.stringify(row), fixture)
}

for (const version of [undefined, null, NaN, Infinity, 0, 1.5]) {
  const d = deps({ getTokenKeyVersion: () => version, decryptToken: () => assert.fail("decrypt") })
  assert.equal((await runXIdentityDiagnostic("u", d.value)).safe_code, "X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_UNAVAILABLE")
}
assert.equal((await runXIdentityDiagnostic("u", deps({ getTokenKeyVersion: () => { throw new Error("version detail") } }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_UNAVAILABLE")
assert.equal((await runXIdentityDiagnostic("u", deps({ getTokenKeyVersion: () => 8, decryptToken: () => assert.fail("decrypt") }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH")
assert.equal((await runXIdentityDiagnostic("u", deps({ decryptToken: () => { throw new Error("decrypt detail") } }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_DECRYPT_FAILED")
for (const token of [null, 1, {}, "", "   "]) assert.equal((await runXIdentityDiagnostic("u", deps({ decryptToken: () => token }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_INVALID")

const statusCases: Array<[number, string]> = [[401,"X_IDENTITY_DIAGNOSTIC_PROVIDER_UNAUTHORIZED"],[403,"X_IDENTITY_DIAGNOSTIC_PROVIDER_FORBIDDEN"],[429,"X_IDENTITY_DIAGNOSTIC_PROVIDER_RATE_LIMITED"],[500,"X_IDENTITY_DIAGNOSTIC_PROVIDER_TEMPORARY_FAILURE"],[503,"X_IDENTITY_DIAGNOSTIC_PROVIDER_TEMPORARY_FAILURE"],[418,"X_IDENTITY_DIAGNOSTIC_PROVIDER_REJECTED"]]
for (const [status, code] of statusCases) {
  const d = deps({ fetchImpl: async () => new Response("raw-provider-secret", { status }) })
  const out = await runXIdentityDiagnostic("u", d.value); assert.equal(out.safe_code, code); assert.equal(JSON.stringify(out).includes("raw-provider-secret"), false)
}
for (const [error, code] of [[Object.assign(new Error(), { name: "TimeoutError" }), "X_IDENTITY_DIAGNOSTIC_TIMEOUT"], [new Error("network detail"), "X_IDENTITY_DIAGNOSTIC_NETWORK_FAILURE"]] as const) {
  assert.equal((await runXIdentityDiagnostic("u", deps({ fetchImpl: async () => { throw error } }).value)).safe_code, code)
}

const malformed: unknown[] = [null,"x",1,[],new (class Example {})(),{}, {data:null},{data:1},{data:[]},{data:{}},{data:{id:1,username:"u"}},{data:{id:" ",username:"u"}},{data:{id:"provider-id"}},{data:{id:"provider-id",username:1}},{data:{id:"provider-id",username:" "}}]
const throwingPrototype = new Proxy({}, { getPrototypeOf() { throw new Error("prototype detail") } }); malformed.push(throwingPrototype)
for (const body of malformed) assert.equal((await runXIdentityDiagnostic("u", deps({ fetchImpl: async () => ({ ok:true, status:200, json:async()=>body }) }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID")
assert.equal((await runXIdentityDiagnostic("u", deps({ fetchImpl: async () => ({ ok:true,status:200,json:async()=>{throw new Error("json detail")}}) }).value)).safe_code, "X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID")

for (const [body, code] of [[{data:{id:"other",username:"other"}},"X_IDENTITY_DIAGNOSTIC_PROVIDER_ID_MISMATCH"],[{data:{id:" provider-id ",username:"other"}},"X_IDENTITY_DIAGNOSTIC_USERNAME_MISMATCH"],[{data:{id:"provider-id",username:"FAKE_HANDLE"}},"X_IDENTITY_DIAGNOSTIC_MATCHED"]] as const)
  assert.equal((await runXIdentityDiagnostic("u", deps({ fetchImpl: async () => new Response(JSON.stringify(body)) }).value)).safe_code, code)

{
  let reads = 0, authTarget = ""
  const base = deps({ loadAccount: async (id: string) => { reads++; authTarget = id; return account } })
  const makeRequest = (url = "https://local.invalid/api", header = CONFIRM) => new Request(url, { method:"POST", headers:{ [HEADER]:header }, body: JSON.stringify({ user_id:"attacker",provider_account_id:"attacker",encrypted_access_token:"attacker" }) })
  for (const auth of [async()=>{throw new Error("auth detail")}, async()=>"   "]) {
    const out = await handleXIdentityDiagnosticRequest({ ...base.value, request:makeRequest(), getAuthenticatedUserId:auth }); assert.equal(out.status,401); assert.equal(out.body.safe_code,"X_IDENTITY_DIAGNOSTIC_UNAUTHENTICATED")
  }
  assert.equal(reads,0)
  assert.equal((await handleXIdentityDiagnosticRequest({ ...base.value, request:makeRequest("https://local.invalid/api", "wrong"), getAuthenticatedUserId:async()=>"session-user" })).body.safe_code,"X_IDENTITY_DIAGNOSTIC_CONFIRMATION_REQUIRED")
  assert.equal((await handleXIdentityDiagnosticRequest({ ...base.value, request:makeRequest("https://local.invalid/api?user_id=attacker"), getAuthenticatedUserId:async()=>"session-user" })).body.safe_code,"X_IDENTITY_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED")
  assert.equal(reads,0)
  const out = await handleXIdentityDiagnosticRequest({ ...base.value, request:makeRequest(), getAuthenticatedUserId:async()=>"session-user" })
  assert.equal(out.body.safe_code,"X_IDENTITY_DIAGNOSTIC_MATCHED"); assert.equal(authTarget,"session-user")
  assert.equal(JSON.stringify(out).includes("provider-id"), false); assert.equal(JSON.stringify(out).includes("Fake_Handle"), false); assert.equal(JSON.stringify(out).includes("token"), false)
}

for (const path of ["lib/autopost/xIdentityDiagnostic.ts","app/api/admin/autopost/x/identity-diagnostic/route.ts","lib/autopost/platformAvailability.ts"]) {
  const source = readFileSync(path,"utf8")
  for (const forbidden of [".update(",".upsert(",".insert(",".delete(",".rpc(","refreshXAccessToken","postXTextOnlyAutopost","/2/tweets","console.log","console.error"]) assert.equal(source.includes(forbidden),false)
}
const route = readFileSync("app/api/admin/autopost/x/identity-diagnostic/route.ts","utf8")
for (const required of ['dynamic = "force-dynamic"','revalidate = 0','private, no-store, max-age=0','export async function POST','export function GET']) assert.ok(route.includes(required))
for (const forbidden of ["request.json(","request.text(","request.formData("]) assert.equal(route.includes(forbidden),false)
for (const path of ["app/autopost/AutopostPageClient.tsx","app/api/autopost/run/route.ts","vercel.json"]) {
  const source=readFileSync(path,"utf8"); for (const needle of ["/api/admin/autopost/x/identity-diagnostic","runXIdentityDiagnostic","handleXIdentityDiagnosticRequest"]) assert.equal(source.includes(needle),false)
}

console.log("X identity diagnostic deterministic read-only tests passed; fake evidence only; no network or Production action occurred.")
