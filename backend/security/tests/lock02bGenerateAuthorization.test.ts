import assert from "node:assert/strict"
import { mock } from "node:test"

// Run from the repository root with:
// node --experimental-test-module-mocks --import tsx backend/security/tests/lock02bGenerateAuthorization.test.ts

type AuthResult = {
  ok: boolean
  user?: { id: string }
  error?: string
  message?: string
  status?: number
}

const originalFetch = globalThis.fetch
const originalEnv = {
  SIRENS_API_BASE_URL: process.env.SIRENS_API_BASE_URL,
  SIRENS_API_INTERNAL_SECRET: process.env.SIRENS_API_INTERNAL_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GENERATION_EXECUTION_ENABLED: process.env.GENERATION_EXECUTION_ENABLED,
}

let authResult: AuthResult
let authCalls = 0
let resolverCalls = 0
let workflowCalls = 0
let downstreamCalls = 0
let insertedRecords: Record<string, unknown>[] = []
let persistenceFails = false
let lastResolverArgs: unknown[] = []
let lastWorkflowArgs: any
let lastDownstreamPayload: any
let lastDownstreamHeaders: Headers | undefined
let upstreamResponse: () => Promise<Response>

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, {
  namedExports: {
    ensureActiveSubscription: async () => {
      authCalls += 1
      return authResult
    },
  },
})

mock.module(new URL("../../../lib/generation/lora-resolver.ts", import.meta.url).href, {
  namedExports: {
    resolveLoraStack: async (...args: unknown[]) => {
      resolverCalls += 1
      lastResolverArgs = args
      return {
        body_mode: args[0],
        identity_lora: args[1],
        trigger_token: "mocktoken",
        loras: [],
      }
    },
  },
})

mock.module(new URL("../../../lib/comfy/buildWorkflow.ts", import.meta.url).href, {
  namedExports: {
    buildWorkflow: (args: unknown) => {
      workflowCalls += 1
      lastWorkflowArgs = args
      return { mocked_workflow: true, received: args }
    },
  },
})

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      from: (table: string) => {
        assert.equal(table, "generations")
        return {
          insert: (record: Record<string, unknown>) => {
            insertedRecords.push(record)
            return {
              select: (columns: string) => {
                assert.equal(columns, "id")
                return {
                  single: async () => ({
                    data: { id: `mock-log-${insertedRecords.length}` },
                    error: persistenceFails ? { message: "mock persistence failure" } : null,
                  }),
                }
              },
            }
          },
        }
      },
    }),
  },
})

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  assert.equal(url, "https://railway.test/gateway/generate", `unexpected external fetch: ${url}`)
  downstreamCalls += 1
  lastDownstreamHeaders = new Headers(init?.headers)
  lastDownstreamPayload = JSON.parse(String(init?.body))
  return upstreamResponse()
}

const { POST } = await import(new URL("../../../app/api/generate/route.ts", import.meta.url).href)

const validBody = {
  prompt: "  portrait lighting  ",
  negative_prompt: " blur ",
  body_mode: "body_feminine",
  identity_lora: " identity/mock.safetensors ",
  width: 4096,
  height: 128,
  steps: 200,
  cfg: 0,
  seed: 42,
  batch: 9,
}

function request(body: unknown) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function configureAuth(next: AuthResult) {
  authResult = next
  authCalls = 0
  resolverCalls = 0
  workflowCalls = 0
  downstreamCalls = 0
  insertedRecords = []
  persistenceFails = false
  lastResolverArgs = []
  lastWorkflowArgs = undefined
  lastDownstreamPayload = undefined
  lastDownstreamHeaders = undefined
  process.env.SIRENS_API_BASE_URL = "https://railway.test"
  process.env.SIRENS_API_INTERNAL_SECRET = "mock-internal-secret"
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role"
  process.env.GENERATION_EXECUTION_ENABLED = "true"
  upstreamResponse = async () =>
    new Response(
      JSON.stringify({
        success: true,
        images: ["https://assets.test/generated.png"],
        prompt_id: "runpod-job-1",
      }),
      { status: 200 },
    )
}

function assertNoPrivilegedActivity() {
  assert.equal(resolverCalls, 0, "resolver activity")
  assert.equal(workflowCalls, 0, "workflow construction")
  assert.equal(downstreamCalls, 0, "downstream generation activity")
  assert.equal(insertedRecords.length, 0, "generation persistence")
}

async function invoke(body: unknown) {
  return POST(request(body) as any)
}

try {
  for (const denied of [
    { status: 401, error: "UNAUTHENTICATED", message: "Log in first" },
    { status: 402, error: "NO_ACTIVE_SUBSCRIPTION", message: "Subscribe first" },
    { status: 403, error: "NO_PROFILE", message: "Profile required" },
    { status: 500, error: "PROFILE_LOOKUP_FAILED", message: "Exact mocked database failure" },
  ]) {
    configureAuth({ ok: false, ...denied })
    const response = await invoke(validBody)
    assert.equal(response.status, denied.status)
    assert.deepEqual(await response.json(), { error: denied.error, message: denied.message })
    assert.equal(authCalls, 1)
    assertNoPrivilegedActivity()
  }

  // A denied identity-LoRA request cannot reach its resolver, cache, or service-role path.
  configureAuth({ ok: false, status: 401, error: "UNAUTHENTICATED", message: "Denied" })
  let response = await invoke({ prompt: "test", identity_lora: "private/user-lora.safetensors" })
  assert.equal(response.status, 401)
  assertNoPrivilegedActivity()

  // Active and trialing users both retain the successful generation behavior.
  for (const status of ["active", "trialing"]) {
    const verifiedUserId = `verified-${status}-user`
    configureAuth({ ok: true, status: 200, user: { id: verifiedUserId } })
    response = await invoke(validBody)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.status, "ok")
    assert.equal(result.image_url, "https://assets.test/generated.png")
    assert.equal(result.generation_id, "runpod-job-1")
    assert.deepEqual(result.history_persistence, { status: "PERSISTED" })
    assert.equal(authCalls, 1)
    assert.equal(resolverCalls, 1)
    assert.equal(workflowCalls, 1)
    assert.equal(downstreamCalls, 1)
    assert.equal(lastDownstreamHeaders?.get("x-sirens-api-internal-secret"), "mock-internal-secret")
    assert.equal(insertedRecords.length, 1)
    assert.equal(insertedRecords[0].user_id, verifiedUserId)
  }

  // Representative normalization and downstream workflow payload are preserved.
  assert.deepEqual(lastResolverArgs, ["body_feminine", "identity/mock.safetensors", "verified-trialing-user"])
  assert.equal(lastWorkflowArgs.prompt, "mocktoken portrait lighting")
  assert.equal(lastWorkflowArgs.negative, "blur")
  assert.deepEqual(
    {
      width: lastWorkflowArgs.width,
      height: lastWorkflowArgs.height,
      steps: lastWorkflowArgs.steps,
      cfg: lastWorkflowArgs.cfg,
      seed: lastWorkflowArgs.seed,
      batch: lastWorkflowArgs.batch,
    },
    { width: 2048, height: 256, steps: 150, cfg: 7, seed: 42, batch: 4 },
  )
  assert.equal(lastDownstreamPayload.workflow.type, "sirens_generate_v1")
  assert.equal(lastDownstreamPayload.workflow.inputs.identity_lora, "identity/mock.safetensors")
  assert.equal(lastDownstreamPayload.workflow.inputs.workflow_json.mocked_workflow, true)

  configureAuth({ ok: true, status: 200, user: { id: "verified-config-user" } })
  delete process.env.SIRENS_API_BASE_URL
  response = await invoke(validBody)
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: "SIRENS_API_BASE_URL_MISSING" })
  assertNoPrivilegedActivity()

  configureAuth({ ok: true, status: 200, user: { id: "verified-secret-user" } })
  delete process.env.SIRENS_API_INTERNAL_SECRET
  response = await invoke(validBody)
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: "SIRENS_API_INTERNAL_SECRET_MISSING" })
  assertNoPrivilegedActivity()

  for (const body of [{}, { prompt: "   " }]) {
    configureAuth({ ok: true, status: 200, user: { id: "verified-prompt-user" } })
    response = await invoke(body)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: "PROMPT_REQUIRED" })
    assert.equal(downstreamCalls, 0)
    assert.equal(insertedRecords.length, 0)
  }

  configureAuth({ ok: true, status: 200, user: { id: "verified-upstream-user" } })
  upstreamResponse = async () => new Response("mock unavailable", { status: 503 })
  response = await invoke(validBody)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: "UPSTREAM_ERROR",
    status: 503,
    generation_id: "mock-log-1",
  })
  assert.equal(downstreamCalls, 1)
  assert.equal(insertedRecords[0].user_id, "verified-upstream-user")

  configureAuth({ ok: true, status: 200, user: { id: "verified-json-user" } })
  upstreamResponse = async () => new Response("not-json", { status: 200 })
  response = await invoke(validBody)
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    error: "UPSTREAM_INVALID_JSON",
    generation_id: "mock-log-1",
  })
  assert.equal(downstreamCalls, 1)
  assert.equal(insertedRecords[0].user_id, "verified-json-user")

  configureAuth({ ok: true, status: 200, user: { id: "verified-malformed-user" } })
  upstreamResponse = async () => new Response(JSON.stringify({ success: true, images: ["file:///private/output"] }), { status: 200 })
  response = await invoke(validBody)
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: "UPSTREAM_INVALID_RESPONSE" })
  assert.equal(insertedRecords.length, 0, "malformed success is never persisted")

  configureAuth({ ok: true, status: 200, user: { id: "verified-persistence-user" } })
  persistenceFails = true
  response = await invoke(validBody)
  assert.equal(response.status, 200)
  const persistenceResult = await response.json()
  assert.equal(persistenceResult.image_url, "https://assets.test/generated.png")
  assert.deepEqual(persistenceResult.history_persistence, { status: "FAILED", code: "GENERATION_HISTORY_PERSISTENCE_FAILED", retry_generation: false })
  assert.equal(downstreamCalls, 1, "persistence failure never repeats generation")

  console.log("lock02bGenerateAuthorization behavioral contract ok")
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  mock.reset()
}
