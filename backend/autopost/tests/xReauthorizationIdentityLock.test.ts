import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"
const emptyServerOnlyModule = "data:text/javascript,export%20{}"
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }; return nextResolve(specifier, context) }`)}`, import.meta.url)
const { completeXReauthorization } = await import("../../../lib/autopost/xReauthorizationCallback")
const EXPECTED_ID = "fake-existing-id", EXPECTED_USERNAME = "Fake_Existing_User", ACCESS = "FAKE_ACCESS_TOKEN_MARKER", REFRESH = "FAKE_REFRESH_TOKEN_MARKER"
const token = { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: "Bearer", scope: "users.read offline.access" }
const identity = { data: { id: EXPECTED_ID, username: "fake_existing_user", name: "Fake Name" } }
const fakeResponse = (body: unknown, ok = true) => ({ ok, json: async () => body } as Response)
function harness(options: { account?: unknown; identity?: unknown; updateData?: unknown[]; updateError?: unknown; encryptThrow?: number; keyThrow?: boolean; adminThrow?: boolean } = {}) {
  const events: string[] = [], filters: [string, unknown][] = [], updates: Record<string, unknown>[] = []
  let requestCount = 0, encryptCount = 0
  const deps = {
    env: { X_CLIENT_ID: "fake-client", X_CLIENT_SECRET: "fake-secret", X_REDIRECT_URI: "https://fake.invalid/callback" }, getApiBaseUrl: () => "https://api.x.invalid", now: () => new Date("2026-07-25T00:00:00.000Z"),
    readCurrentAccount: async () => { events.push("read"); return { data: options.account === undefined ? { connection_status: "CONNECTED", provider_account_id: EXPECTED_ID, provider_username: EXPECTED_USERNAME, metadata: { retained: true } } : options.account, error: null } },
    fetchImpl: async () => { events.push(requestCount++ ? "identity" : "token"); return fakeResponse(requestCount === 1 ? token : (options.identity ?? identity)) },
    encryptToken: (value: string) => { events.push("encrypt"); if (++encryptCount === options.encryptThrow) throw new Error("fake"); return `encrypted-${value}` },
    getTokenKeyVersion: () => { events.push("key"); if (options.keyThrow) throw new Error("fake"); return 7 },
    getSupabaseAdmin: () => { events.push("admin"); if (options.adminThrow) throw new Error("fake"); return { from: (table: string) => { assert.equal(table, "autopost_accounts"); return { update: (value: Record<string, unknown>) => { updates.push(value); events.push("update"); const chain = { eq: (column: string, value: unknown) => { filters.push([column, value]); return chain }, select: async () => ({ data: options.updateData ?? [{ id: "fake-row" }], error: options.updateError ?? null }) }; return chain } } } } as never },
  }
  const run = () => completeXReauthorization({ userId: "fake-user", code: "fake-code", codeVerifier: "fake-verifier", expectedProviderAccountId: EXPECTED_ID, expectedProviderUsername: EXPECTED_USERNAME }, deps)
  return { run, events, filters, updates }
}
{
  const h = harness(), outcome = await h.run(); assert.equal(outcome.safe_code, "X_REAUTH_SUCCEEDED")
  assert.deepEqual(h.events, ["read", "token", "identity", "encrypt", "encrypt", "key", "admin", "update"])
  assert.deepEqual(h.filters, [["user_id", "fake-user"], ["platform", "x"], ["provider_account_id", EXPECTED_ID], ["provider_username", EXPECTED_USERNAME], ["connection_status", "CONNECTED"]])
  assert.deepEqual(Object.keys(h.updates[0]).sort(), ["connection_status", "display_name", "encrypted_access_token", "encrypted_refresh_token", "last_error", "last_refresh_at", "metadata", "provider_username", "scopes", "token_expires_at", "token_key_version", "token_type"].sort())
  assert.equal((h.updates[0].metadata as Record<string, unknown>).retained, true)
}
for (const account of [null, { connection_status: "DISCONNECTED", provider_account_id: EXPECTED_ID, provider_username: EXPECTED_USERNAME }, { connection_status: "CONNECTED", provider_account_id: "", provider_username: EXPECTED_USERNAME }]) { const h = harness({ account }); assert.equal((await h.run()).safe_code, "X_REAUTH_ACCOUNT_NOT_READY"); assert.deepEqual(h.events, ["read"]) }
{ const h = harness({ account: { connection_status: "CONNECTED", provider_account_id: "changed", provider_username: EXPECTED_USERNAME } }); assert.equal((await h.run()).safe_code, "X_REAUTH_ACCOUNT_CHANGED"); assert.deepEqual(h.events, ["read"]) }
for (const [returnedIdentity, code] of [[{ data: { id: "other", username: EXPECTED_USERNAME } }, "X_REAUTH_PROVIDER_ID_MISMATCH"], [{ data: { id: EXPECTED_ID, username: "other" } }, "X_REAUTH_USERNAME_MISMATCH"]] as const) { const h = harness({ identity: returnedIdentity }); assert.equal((await h.run()).safe_code, code); assert.ok(!h.events.includes("encrypt") && !h.events.includes("admin") && !h.events.includes("update")) }
for (const options of [{ encryptThrow: 1 }, { encryptThrow: 2 }, { keyThrow: true }, { adminThrow: true }]) { const h = harness(options); assert.equal((await h.run()).safe_code, "X_REAUTH_TOKEN_ENCRYPTION_FAILED"); assert.ok(!h.events.includes("update")) }
assert.equal((await harness({ updateData: [] }).run()).safe_code, "X_REAUTH_ACCOUNT_CHANGED")
assert.equal((await harness({ updateError: { fake: true } }).run()).safe_code, "X_REAUTH_ACCOUNT_UPDATE_FAILED")
const route = readFileSync("app/api/admin/autopost/x/reauthorize/route.ts", "utf8"), callback = readFileSync("app/api/autopost/connect/x/callback/route.ts", "utf8"), oauth = readFileSync("lib/autopost/xOAuth.ts", "utf8"), helper = readFileSync("lib/autopost/xReauthorizationCallback.ts", "utf8")
assert.match(route, /select\("connection_status, provider_account_id, provider_username"\)/); assert.match(route, /\.eq\("platform", "x"\)[\s\S]*\.maybeSingle\(\)/); assert.ok(route.indexOf("requireUserId") < route.indexOf("getSupabaseAdmin()")); assert.match(route, /export async function GET/)
assert.match(oauth, /flow\?: "initial" \| "reauthorize"/); assert.match(callback, /completeInitialXOAuthConnection/); assert.match(callback, /completeXReauthorization/); assert.ok(!route.includes('"fanvue"')); assert.ok(!helper.includes('platform", "fanvue"'))
for (const value of [ACCESS, REFRESH, EXPECTED_ID, EXPECTED_USERNAME]) assert.ok(!JSON.stringify(await harness().run()).includes(value))
console.log("xReauthorizationIdentityLock tests passed")
