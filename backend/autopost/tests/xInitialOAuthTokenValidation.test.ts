import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

const emptyServerOnlyModule = "data:text/javascript,export%20{}"
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }; return nextResolve(specifier, context) }`
  )}`,
  import.meta.url
)
const { completeInitialXOAuthConnection } = await import("../../../lib/autopost/xInitialOAuthCallback")

const ACCESS = "FAKE_ACCESS_TOKEN_MARKER"
const REFRESH = "FAKE_REFRESH_TOKEN_MARKER"
const ENCRYPTED = "FAKE_ENCRYPTED_MARKER"
const SECRET = "FAKE_CLIENT_SECRET_MARKER"
const RAW = "FAKE_RAW_PROVIDER_BODY_MARKER"
const NOW = new Date("2026-01-02T03:04:05.000Z")
const TOKEN_ENDPOINT = "https://api.x.invalid/2/oauth2/token"
const IDENTITY_ENDPOINT = "https://api.x.invalid/2/users/me"
const REDIRECT_URI = "https://callback.x.invalid/callback"
const EXPECTED_BASIC_AUTH = `Basic ${Buffer.from(`FAKE_CLIENT_ID:${SECRET}`).toString("base64")}`

const validToken = () => ({
  access_token: ACCESS,
  refresh_token: REFRESH,
  expires_in: 3600,
  token_type: "bearer",
  scope: "tweet.read tweet.write users.read offline.access",
})
const validIdentity = () => ({ data: { id: "fake-provider-id", username: "fake_user", name: "Fake User" } })
const existing = () => ({
  connection_status: "CONNECTED",
  encrypted_access_token: "EXISTING_FAKE_ACCESS",
  encrypted_refresh_token: "EXISTING_FAKE_REFRESH",
  provider_account_id: "existing-fake-id",
  provider_username: "existing_fake_user",
  display_name: "Existing Fake User",
  connected_at: "2025-01-01T00:00:00.000Z",
  last_refresh_at: null,
  last_error: null,
  metadata: { provider: "x", identity_fetched: true },
})

type ResponseSpec = { ok?: boolean; body?: unknown; jsonError?: boolean; throwFetch?: boolean }
type RequestRecord = {
  kind: "token" | "identity"
  url: string
  method: string
  authorization: string | null
  contentType: string | null
  body: RequestInit["body"]
}

function response(spec: ResponseSpec): Response {
  return {
    ok: spec.ok ?? true,
    json: async () => {
      if (spec.jsonError) throw new Error("fake invalid json")
      return spec.body
    },
  } as Response
}

function safe(result: unknown) {
  const serialized = JSON.stringify(result)
  for (const marker of [ACCESS, REFRESH, SECRET, RAW, ENCRYPTED]) {
    assert.ok(!serialized.includes(marker), `safe result must not contain ${marker}`)
  }
}

function harness(
  options: {
    token?: ResponseSpec
    identity?: ResponseSpec
    tokenBody?: unknown
    identityBody?: unknown
    now?: Date
    envScopes?: string
    encryptThrowAt?: number
    keyThrow?: boolean
    clientThrow?: boolean
    upsertError?: boolean
  } = {}
) {
  const account = existing()
  const before = structuredClone(account)
  const events: string[] = []
  const encrypted: string[] = []
  const writes: any[] = []
  const requests: RequestRecord[] = []
  const tokenSpec = options.token ?? {
    body: Object.prototype.hasOwnProperty.call(options, "tokenBody") ? options.tokenBody : validToken(),
  }
  const identitySpec = options.identity ?? {
    body: Object.prototype.hasOwnProperty.call(options, "identityBody") ? options.identityBody : validIdentity(),
  }
  let fetchCount = 0
  let keyCalls = 0
  let clientCalls = 0

  const deps = {
    env: {
      X_CLIENT_ID: "FAKE_CLIENT_ID",
      X_CLIENT_SECRET: SECRET,
      X_REDIRECT_URI: REDIRECT_URI,
      ...(options.envScopes === undefined ? {} : { X_OAUTH_SCOPES: options.envScopes }),
    },
    getApiBaseUrl: () => "https://api.x.invalid",
    now: () => options.now ?? new Date(NOW),
    fetchImpl: async (url: string | URL | Request, init: RequestInit = {}) => {
      fetchCount++
      const kind = fetchCount === 1 ? "token" : "identity"
      const spec = kind === "token" ? tokenSpec : identitySpec
      const headers = new Headers(init.headers)
      const record: RequestRecord = {
        kind,
        url: String(url),
        method: String(init.method ?? "GET").toUpperCase(),
        authorization: headers.get("authorization"),
        contentType: headers.get("content-type"),
        body: init.body,
      }
      requests.push(record)
      events.push(kind === "token" ? "token-request" : "identity-request")

      if (kind === "token") {
        assert.equal(record.url, TOKEN_ENDPOINT)
        assert.equal(record.method, "POST")
        assert.equal(record.authorization, EXPECTED_BASIC_AUTH)
        assert.equal(record.contentType, "application/x-www-form-urlencoded")
        const formBody = record.body
        if (!(formBody instanceof URLSearchParams)) throw new Error("token request body must be URLSearchParams")
        assert.equal(formBody.get("code"), "fake-code")
        assert.equal(formBody.get("grant_type"), "authorization_code")
        assert.equal(formBody.get("redirect_uri"), REDIRECT_URI)
        assert.equal(formBody.get("code_verifier"), "fake-verifier")
        const serializedFormBody = formBody.toString()
        assert.equal(serializedFormBody.includes(ACCESS), false)
        assert.equal(serializedFormBody.includes(REFRESH), false)
      } else {
        assert.equal(record.url, IDENTITY_ENDPOINT)
        assert.equal(record.method, "GET")
        assert.equal(record.authorization, `Bearer ${ACCESS}`)
        assert.equal(record.authorization?.startsWith("Basic "), false)
        assert.equal(record.body, undefined)
      }

      if (spec.throwFetch) throw new Error("fake fetch failure")
      return response(spec)
    },
    encryptToken: (value: string) => {
      events.push(`encrypt:${value === ACCESS ? "access" : "refresh"}`)
      encrypted.push(value)
      if (options.encryptThrowAt === encrypted.length) throw new Error("fake encryption failure")
      return `${ENCRYPTED}:${value}`
    },
    getTokenKeyVersion: () => {
      events.push("token-key-version")
      keyCalls++
      if (options.keyThrow) throw new Error("fake key failure")
      return 7
    },
    getSupabaseAdmin: () => {
      events.push("client-construction")
      clientCalls++
      if (options.clientThrow) throw new Error("fake client failure")
      return {
        from: (table: string) => ({
          upsert: async (values: any, config: any) => {
            events.push("upsert")
            writes.push({ table, values, config })
            if (!options.upsertError) Object.assign(account, values)
            return { error: options.upsertError ? { message: RAW } : null }
          },
        }),
      } as any
    },
  }

  return {
    account,
    before,
    events,
    encrypted,
    writes,
    requests,
    counts: () => ({ fetchCount, keyCalls, clientCalls }),
    run: () =>
      completeInitialXOAuthConnection(
        { userId: "fake-authenticated-user", code: "fake-code", codeVerifier: "fake-verifier" },
        deps as any
      ),
  }
}

async function assertTokenValidationFailure(h: ReturnType<typeof harness>, code = "X_TOKEN_RESPONSE_INVALID") {
  const result = await h.run()
  assert.deepEqual(result, { ok: false, error_code: code })
  safe(result)
  assert.deepEqual(h.account, h.before)
  assert.equal(h.counts().fetchCount, 1)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0]?.kind, "token")
  assert.deepEqual(h.events, ["token-request"])
  assert.equal(h.encrypted.length, 0)
  assert.equal(h.counts().keyCalls, 0)
  assert.equal(h.counts().clientCalls, 0)
  assert.equal(h.writes.length, 0)
}

async function assertIdentityValidationFailure(h: ReturnType<typeof harness>, code: string) {
  const result = await h.run()
  assert.deepEqual(result, { ok: false, error_code: code })
  safe(result)
  assert.deepEqual(h.account, h.before)
  assert.equal(h.counts().fetchCount, 2)
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.requests.map((request) => request.kind), ["token", "identity"])
  assert.deepEqual(h.events, ["token-request", "identity-request"])
  assert.equal(h.encrypted.length, 0)
  assert.equal(h.counts().keyCalls, 0)
  assert.equal(h.counts().clientCalls, 0)
  assert.equal(h.writes.length, 0)
}

for (const body of [null, RAW, 3, true, []] as const) {
  await assertTokenValidationFailure(harness({ tokenBody: body }))
}
await assertTokenValidationFailure(harness({ token: { jsonError: true } }))
for (const [field, values] of [
  ["access_token", [undefined, null, 4, "", "   "]],
  ["refresh_token", [undefined, null, 4, "", "   "]],
  ["expires_in", [undefined, null, "3600", NaN, Infinity, -Infinity, 0, -1]],
  ["token_type", [undefined, null, 4, "", "   ", "mac"]],
  ["scope", [null, 4, "", "   "]],
] as const) {
  for (const value of values) {
    const body: any = validToken()
    if (value === undefined) delete body[field]
    else body[field] = value
    await assertTokenValidationFailure(harness({ tokenBody: body }))
  }
}
await assertTokenValidationFailure(harness({ now: new Date(NaN) }))
await assertTokenValidationFailure(harness({ tokenBody: { ...validToken(), expires_in: Number.MAX_VALUE } }))

for (const body of [
  null,
  RAW,
  [],
  {},
  { data: null },
  { data: RAW },
  { data: { username: "u" } },
  { data: { id: 2, username: "u" } },
  { data: { id: "", username: "u" } },
  { data: { id: "  ", username: "u" } },
  { data: { id: "id" } },
  { data: { id: "id", username: 2 } },
  { data: { id: "id", username: "" } },
  { data: { id: "id", username: "  " } },
]) {
  await assertIdentityValidationFailure(harness({ identityBody: body }), "X_IDENTITY_RESPONSE_INVALID")
}
await assertIdentityValidationFailure(harness({ identity: { jsonError: true } }), "X_IDENTITY_RESPONSE_INVALID")
await assertIdentityValidationFailure(
  harness({ identity: { ok: false, body: { error: RAW } } }),
  "X_IDENTITY_LOOKUP_FAILED"
)
await assertIdentityValidationFailure(harness({ identity: { throwFetch: true } }), "X_IDENTITY_LOOKUP_FAILED")

for (const failure of [{ encryptThrowAt: 1 }, { encryptThrowAt: 2 }, { keyThrow: true }] as const) {
  const h = harness(failure)
  const result = await h.run()
  assert.equal(result.ok, false)
  safe(result)
  assert.deepEqual(h.account, h.before)
  assert.equal(h.counts().clientCalls, 0)
  assert.equal(h.writes.length, 0)
}
{
  const h = harness({ clientThrow: true })
  const result = await h.run()
  assert.equal(result.ok, false)
  safe(result)
  assert.deepEqual(h.account, h.before)
  assert.equal(h.counts().clientCalls, 1)
  assert.equal(h.writes.length, 0)
}
{
  const h = harness({ upsertError: true })
  const result = await h.run()
  assert.deepEqual(result, { ok: false, error_code: "X_OAUTH_ACCOUNT_SAVE_FAILED" })
  safe(result)
  assert.deepEqual(h.account, h.before)
  assert.equal(h.counts().clientCalls, 1)
  assert.equal(h.writes.length, 1)
}

async function success(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  const result = await h.run()
  assert.deepEqual(result, { ok: true })
  safe(result)
  assert.equal(h.writes.length, 1)
  return h
}

{
  const h = await success({
    tokenBody: {
      ...validToken(),
      access_token: `  ${ACCESS}  `,
      refresh_token: `  ${REFRESH}  `,
      token_type: "  BeArEr  ",
      scope: " tweet.write  tweet.read tweet.write ",
    },
    identityBody: { data: { id: " fake-id ", username: " fake-name ", name: " Display Name " } },
  })
  assert.deepEqual(h.events, [
    "token-request",
    "identity-request",
    "encrypt:access",
    "encrypt:refresh",
    "token-key-version",
    "client-construction",
    "upsert",
  ])
  assert.equal(h.counts().fetchCount, 2)
  assert.equal(h.requests[1]?.authorization, `Bearer ${ACCESS}`)
  assert.equal(h.requests[1]?.body, undefined)
  assert.deepEqual(h.encrypted, [ACCESS, REFRESH])
  assert.equal(h.counts().keyCalls, 1)
  assert.equal(h.counts().clientCalls, 1)
  const write = h.writes[0]
  assert.equal(write.table, "autopost_accounts")
  assert.deepEqual(write.config, { onConflict: "user_id,platform" })
  assert.deepEqual(write.values, {
    user_id: "fake-authenticated-user",
    platform: "x",
    provider_account_id: "fake-id",
    provider_username: "fake-name",
    display_name: "Display Name",
    token_type: "bearer",
    scopes: ["tweet.write", "tweet.read"],
    encrypted_access_token: `${ENCRYPTED}:${ACCESS}`,
    encrypted_refresh_token: `${ENCRYPTED}:${REFRESH}`,
    token_key_version: 7,
    token_expires_at: "2026-01-02T04:04:05.000Z",
    connection_status: "CONNECTED",
    connected_at: "2026-01-02T03:04:05.000Z",
    last_refresh_at: null,
    last_error: null,
    metadata: { provider: "x", identity_fetched: true, identity_name: "Display Name" },
  })
}
{
  const configured = await success({
    tokenBody: (() => {
      const token: any = validToken()
      delete token.scope
      return token
    })(),
    envScopes: " users.read users.read offline.access ",
  })
  assert.deepEqual(configured.writes[0].values.scopes, ["users.read", "offline.access"])

  const defaults = await success({
    tokenBody: (() => {
      const token: any = validToken()
      delete token.scope
      return token
    })(),
    envScopes: "   ",
    identityBody: { data: { id: " id ", username: " user ", name: "   " } },
  })
  assert.deepEqual(defaults.writes[0].values.scopes, ["tweet.read", "tweet.write", "users.read", "offline.access"])
  assert.equal(defaults.writes[0].values.display_name, "user")
}

const route = readFileSync("app/api/autopost/connect/x/callback/route.ts", "utf8")
for (const value of [
  "connected: \"x\"",
  "error: \"x_oauth_account_save_failed\"",
  "error: \"x_oauth_failed\"",
]) {
  assert.ok(route.includes(value))
}
assert.ok(!route.includes("completion.error_code })"))
assert.ok(readFileSync("package.json", "utf8").includes("tsx backend/autopost/tests/xInitialOAuthTokenValidation.test.ts"))
console.log("xInitialOAuthTokenValidation.test.ts: all assertions passed")
