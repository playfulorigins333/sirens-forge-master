import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { mock } from "node:test"

// Run from the repository root with:
// node --experimental-test-module-mocks --import tsx backend/security/tests/lock02fAuthenticatedApiBoundary.test.ts

const ownerId = "owner-user"
const jobId = "11111111-1111-4111-8111-111111111111"
const secret = "deterministic-test-secret"
const originalFetch = globalThis.fetch
const originalEnv = {
  SIRENS_API_BASE_URL: process.env.SIRENS_API_BASE_URL,
  SIRENS_API_INTERNAL_SECRET: process.env.SIRENS_API_INTERNAL_SECRET,
}

type AuthResult = {
  ok: boolean
  user?: { id: string }
  subscription?: { status: string }
  error?: string
  message?: string
  status?: number
}

let authResult: AuthResult = { ok: true, user: { id: ownerId } }
let adminCalls = 0
let ownershipQueries: Array<[string, string]> = []
let railwayCalls: Array<{ url: string; init?: RequestInit }> = []

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, {
  namedExports: {
    ensureActiveSubscription: async () => authResult,
  },
})

mock.module(new URL("../../../lib/supabaseAdmin.ts", import.meta.url).href, {
  namedExports: {
    getSupabaseAdmin: () => {
      adminCalls += 1
      return {
        from: (table: string) => {
          assert.equal(table, "dataset_doctor_jobs")
          const filters: Record<string, string> = {}
          const chain = {
            select: (columns: string) => {
              assert.equal(columns, "id")
              return chain
            },
            eq: (column: string, value: string) => {
              filters[column] = value
              return chain
            },
            maybeSingle: async () => {
              ownershipQueries.push([filters.id, filters.user_id])
              const owned = filters.id === jobId && filters.user_id === ownerId
              return { data: owned ? { id: jobId } : null, error: null }
            },
          }
          return chain
        },
      }
    },
  },
})

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  railwayCalls.push({ url, init })
  return new Response(JSON.stringify({ ok: true, marker: "safe-response" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { proxyDatasetDoctorOperation } = await import(
  new URL("../../../lib/datasetDoctorProxy.ts", import.meta.url).href
)

function reset() {
  authResult = { ok: true, user: { id: ownerId } }
  adminCalls = 0
  ownershipQueries = []
  railwayCalls = []
  process.env.SIRENS_API_BASE_URL = "https://railway.invalid///"
  process.env.SIRENS_API_INTERNAL_SECRET = secret
}

function request(method: string, body?: unknown) {
  return new Request("http://localhost/test", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

try {
  reset()
  authResult = {
    ok: false,
    error: "UNAUTHENTICATED",
    message: "You must be logged in.",
    status: 401,
  }
  let response = await proxyDatasetDoctorOperation(request("POST"), jobId, "analyze")
  assert.equal(response.status, 401)
  assert.equal(adminCalls, 0)
  assert.equal(railwayCalls.length, 0)

  for (const inactiveStatus of ["no subscription", "canceled", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired"]) {
    reset()
    authResult = {
      ok: false,
      error: "NO_ACTIVE_SUBSCRIPTION",
      message: `Inactive subscription: ${inactiveStatus}`,
      status: 402,
    }
    response = await proxyDatasetDoctorOperation(request("POST"), jobId, "analyze")
    assert.equal(response.status, 402)
    assert.equal(adminCalls, 0, `${inactiveStatus} must not reach the ownership database`)
    assert.equal(railwayCalls.length, 0, `${inactiveStatus} must not reach Dataset Doctor`)
  }

  reset()
  authResult = { ok: true, user: { id: "foreign-user" } }
  response = await proxyDatasetDoctorOperation(request("POST"), jobId, "analyze")
  assert.equal(response.status, 404)
  assert.deepEqual(ownershipQueries, [[jobId, "foreign-user"]])
  assert.equal(railwayCalls.length, 0)

  for (const [operation, subscriptionStatus] of [
    ["analyze", "active"],
    ["images", "trialing"],
    ["approve", "active"],
  ] as const) {
    reset()
    authResult = {
      ok: true,
      user: { id: ownerId },
      subscription: { status: subscriptionStatus },
    }
    const inbound =
      operation === "approve"
        ? request("POST", {
            selected_image_ids: ["image-1", "image_2.jpg"],
            queue_training: true,
          })
        : operation === "images"
          ? request("GET")
          : request("POST", { arbitrary: true })
    response = await proxyDatasetDoctorOperation(inbound, jobId, operation)
    assert.equal(response.status, 200)
    assert.equal(railwayCalls.length, 1)
    assert.equal(
      railwayCalls[0].url,
      `https://railway.invalid/dataset-doctor/jobs/${jobId}/${operation}`,
    )
    assert.equal(ownershipQueries.length, 1, "ownership must precede the sole upstream fetch")
    const headers = new Headers(railwayCalls[0].init?.headers)
    assert.equal(headers.get("x-sirens-api-internal-secret"), secret)
    assert.doesNotMatch(await response.text(), new RegExp(secret))

    if (operation === "images") {
      assert.equal(railwayCalls[0].init?.method, "GET")
      assert.equal(railwayCalls[0].init?.body, undefined)
    } else if (operation === "analyze") {
      assert.deepEqual(JSON.parse(String(railwayCalls[0].init?.body)), {
        rebuild_from_r2: true,
      })
    } else {
      assert.deepEqual(JSON.parse(String(railwayCalls[0].init?.body)), {
        selected_image_ids: ["image-1", "image_2.jpg"],
        queue_training: false,
      })
    }
  }

  reset()
  delete process.env.SIRENS_API_INTERNAL_SECRET
  response = await proxyDatasetDoctorOperation(request("GET"), jobId, "images")
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: "SIRENS_API_INTERNAL_SECRET_MISSING" })
  assert.equal(adminCalls, 0)
  assert.equal(railwayCalls.length, 0)

  reset()
  delete process.env.SIRENS_API_BASE_URL
  response = await proxyDatasetDoctorOperation(request("GET"), jobId, "images")
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: "SIRENS_API_BASE_URL_MISSING" })
  assert.equal(adminCalls, 0)
  assert.equal(railwayCalls.length, 0)

  const apiClientSource = await readFile("lib/sirensApi.ts", "utf8")
  assert.deepEqual(
    [...apiClientSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]),
    ["SIRENS_API_BASE_URL", "SIRENS_API_INTERNAL_SECRET"],
  )

  const clientSource = await readFile("app/lora/train/TrainPageClient.tsx", "utf8")
  assert.doesNotMatch(clientSource, /sirens-forge-api-production\.up\.railway\.app/)
  assert.doesNotMatch(clientSource, /DATASET_DOCTOR_BASE_URL/)
  for (const operation of ["analyze", "images", "approve"]) {
    assert.match(clientSource, new RegExp(`/api/lora/dataset-doctor/jobs/\\$\\{jobId\\}/${operation}`))
  }
  assert.match(clientSource, /fetch\(putUrl/)
  assert.match(clientSource, /fetch\("\/api\/lora\/get-upload-urls"/)
  assert.match(clientSource, /fetch\("\/api\/lora\/train"/)

  console.log("lock02fAuthenticatedApiBoundary behavioral contract ok")
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  mock.reset()
}
