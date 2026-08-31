import assert from "node:assert/strict"
import { mock } from "node:test"

// Run locally from the repository root with a Node version that supports
// node:test module mocks (the repository currently uses Node 24 in CI work):
// node --experimental-test-module-mocks --import tsx backend/security/tests/lock02aSirensMindBehavior.test.ts

type MockAuthResult = {
  ok: boolean
  error?: string
  message?: string
  status?: number
}

type ProviderResponder = () => Promise<Response>

const originalProviderKey = process.env.OPENAI_COMPAT_API_KEY
const originalProviderBaseUrl = process.env.OPENAI_COMPAT_BASE_URL
const originalFetch = globalThis.fetch

let authCalls = 0
let providerCalls = 0
let authResult: MockAuthResult = {
  ok: false,
  error: "UNAUTHENTICATED",
  message: "Mock unauthenticated",
  status: 401,
}
let providerResponder: ProviderResponder = async () =>
  Response.json({
    choices: [{ message: { content: "mock polished prompt" } }],
  })
let lastProviderUrl = ""
let lastProviderInit: RequestInit | undefined

// Install the network fake before importing the route. If the subscription
// mock ever failed and real Supabase code tried to reach the network, this
// fake would fail the test instead of allowing an external request.
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url

  assert.equal(
    url,
    "https://provider.test/chat/completions",
    `unexpected external fetch attempted: ${url}`
  )

  providerCalls += 1
  lastProviderUrl = url
  lastProviderInit = init
  return providerResponder()
}

const subscriptionModuleUrl = new URL(
  "../../../lib/subscription-checker.ts",
  import.meta.url
)

mock.module(subscriptionModuleUrl.href, {
  namedExports: {
    ensureActiveSubscription: async () => {
      authCalls += 1
      return authResult
    },
  },
})

const routeModuleUrl = new URL(
  "../../../app/api/nsfw-gpt/headless/route.ts",
  import.meta.url
)
const { POST } = await import(routeModuleUrl.href)

const validBody = {
  mode: "SAFE",
  description: "Create a polished portrait",
  output_type: "IMAGE",
  generation_target: "text_to_image",
  vault_ids: [],
  macro_ids: [],
  history: [],
}

function setProviderConfig() {
  process.env.OPENAI_COMPAT_API_KEY = "mock-provider-key"
  process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
}

function resetScenario(nextAuth: MockAuthResult) {
  authResult = nextAuth
  authCalls = 0
  providerCalls = 0
  lastProviderUrl = ""
  lastProviderInit = undefined
  providerResponder = async () =>
    Response.json({
      choices: [{ message: { content: "mock polished prompt" } }],
    })
  setProviderConfig()
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/nsfw-gpt/headless", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function invalidJsonRequest() {
  return new Request("http://localhost/api/nsfw-gpt/headless", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-valid-json",
  })
}

async function invoke(request: Request) {
  return POST(request as any)
}

try {
  // 1. Anonymous -> 401 UNAUTHENTICATED, zero provider calls.
  resetScenario({
    ok: false,
    error: "UNAUTHENTICATED",
    message: "Mock unauthenticated",
    status: 401,
  })
  let response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: "UNAUTHENTICATED",
    message: "Mock unauthenticated",
  })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 2. Authenticated but inactive -> 402 NO_ACTIVE_SUBSCRIPTION, zero provider calls.
  resetScenario({
    ok: false,
    error: "NO_ACTIVE_SUBSCRIPTION",
    message: "Mock inactive subscription",
    status: 402,
  })
  response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 402)
  assert.deepEqual(await response.json(), {
    error: "NO_ACTIVE_SUBSCRIPTION",
    message: "Mock inactive subscription",
  })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 3. Representative entitlement/profile lookup failure preserves helper contract.
  resetScenario({
    ok: false,
    error: "PROFILE_LOOKUP_FAILED",
    message: "Mock profile lookup failure",
    status: 500,
  })
  response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {
    error: "PROFILE_LOOKUP_FAILED",
    message: "Mock profile lookup failure",
  })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 4. Active/trialing entitled user + valid request preserves success behavior.
  resetScenario({ ok: true, status: 200 })
  response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 200)
  const success = await response.json()
  assert.equal(success.status, "ok")
  assert.equal(success.mode, "SAFE")
  assert.equal(success.model, "openai/gpt-5-mini")
  assert.equal(success.output_type, "IMAGE")
  assert.equal(success.generation_target, "text_to_image")
  assert.equal(success.prompt, "mock polished prompt")
  assert.equal(success.raw_text, "mock polished prompt")
  assert.equal(success.metadata?.contract_parse, "ok")
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 1)
  assert.equal(lastProviderUrl, "https://provider.test/chat/completions")
  const providerHeaders = new Headers(lastProviderInit?.headers)
  assert.equal(providerHeaders.get("authorization"), "Bearer mock-provider-key")
  assert.equal(providerHeaders.get("content-type"), "application/json")
  const providerBody = JSON.parse(String(lastProviderInit?.body || "{}"))
  assert.equal(providerBody.model, "openai/gpt-5-mini")
  assert.equal(providerBody.max_tokens, 2000)
  assert.equal(providerBody.temperature, 0.6)
  assert.ok(Array.isArray(providerBody.messages))
  assert.equal(providerBody.messages.at(-1)?.role, "user")
  assert.equal(providerBody.messages.at(-1)?.content, validBody.description)

  // 5. Active entitled user + missing provider configuration fails closed.
  resetScenario({ ok: true, status: 200 })
  delete process.env.OPENAI_COMPAT_API_KEY
  delete process.env.OPENAI_COMPAT_BASE_URL
  response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {
    error: "SERVER_MISCONFIGURED",
    reason: "Missing OPENAI_COMPAT_API_KEY or OPENAI_COMPAT_BASE_URL",
  })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 6. Active entitled user + invalid JSON preserves INVALID_JSON behavior.
  resetScenario({ ok: true, status: 200 })
  response = await invoke(invalidJsonRequest())
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "INVALID_JSON" })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 7a. Active entitled user + missing description preserves validation behavior.
  resetScenario({ ok: true, status: 200 })
  response = await invoke(jsonRequest({ mode: "SAFE", description: "" }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "MISSING_DESCRIPTION" })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 7b. Active entitled user + invalid mode preserves validation behavior.
  resetScenario({ ok: true, status: 200 })
  response = await invoke(
    jsonRequest({ mode: "NOT_A_MODE", description: "Mock prompt" })
  )
  assert.equal(response.status, 400)
  const invalidMode = await response.json()
  assert.equal(invalidMode.error, "INVALID_MODE")
  assert.deepEqual(invalidMode.allowed, ["SAFE", "NSFW", "ULTRA"])
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 0)

  // 8. Active entitled user + provider failure preserves PROVIDER_ERROR behavior.
  resetScenario({ ok: true, status: 200 })
  providerResponder = async () =>
    Response.json({ error: "mock provider unavailable" }, { status: 503 })
  response = await invoke(jsonRequest(validBody))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: "PROVIDER_ERROR",
    provider_status: 503,
    raw: { error: "mock provider unavailable" },
  })
  assert.equal(authCalls, 1)
  assert.equal(providerCalls, 1)

  console.log("lock02aSirensMindBehavior behavioral contract ok")
} finally {
  globalThis.fetch = originalFetch

  if (originalProviderKey === undefined) {
    delete process.env.OPENAI_COMPAT_API_KEY
  } else {
    process.env.OPENAI_COMPAT_API_KEY = originalProviderKey
  }

  if (originalProviderBaseUrl === undefined) {
    delete process.env.OPENAI_COMPAT_BASE_URL
  } else {
    process.env.OPENAI_COMPAT_BASE_URL = originalProviderBaseUrl
  }

  mock.reset()
}
