import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

// Run from the repository root with:
// npx tsx backend/security/tests/lock02dLegacyLoraRoutesDisabled.test.ts

const routeDefinitions = [
  {
    name: "start-training",
    url: new URL("../../../app/api/lora/start-training/route.ts", import.meta.url),
  },
  {
    name: "upload-dataset",
    url: new URL("../../../app/api/lora/upload-dataset/route.ts", import.meta.url),
  },
]

const expectedResponse = {
  error: "LEGACY_LORA_ENDPOINT_DISABLED",
  message: "This legacy LoRA endpoint is disabled. Use the current LoRA training flow.",
}

const originalFetch = globalThis.fetch
let externalFetchCalls = 0
let bodyParseCalls = 0

globalThis.fetch = async () => {
  externalFetchCalls += 1
  throw new Error("Disabled legacy LoRA routes must not perform external fetches")
}

function request(path: string, body?: BodyInit, anonymous = false) {
  const headers = new Headers()
  if (!anonymous) headers.set("Cookie", "session=representative-session")

  const req = new Request(`http://localhost/api/lora/${path}`, {
    method: "POST",
    headers,
    body,
  })

  for (const method of ["formData", "json", "text", "arrayBuffer", "blob"] as const) {
    Object.defineProperty(req, method, {
      value: async () => {
        bodyParseCalls += 1
        throw new Error(`Disabled route attempted request.${method}()`)
      },
    })
  }

  return req
}

const cases = [
  { name: "representative", body: "lora_id=owned-id&images=representative" },
  { name: "anonymous", body: "lora_id=anonymous-id", anonymous: true },
  { name: "foreign arbitrary lora_id", body: "lora_id=another-users-lora" },
  { name: "malformed", body: "not valid multipart or json \u0000 {" },
  { name: "empty" },
]

try {
  for (const route of routeDefinitions) {
    const routeSource = await readFile(route.url, "utf8")
    const { POST } = await import(route.url.href)

    for (const testCase of cases) {
      const response = await POST(
        request(route.name, testCase.body, testCase.anonymous),
      )
      const responseBody = await response.json()

      assert.equal(response.status, 410, `${route.name}/${testCase.name}: status`)
      assert.deepEqual(
        responseBody,
        expectedResponse,
        `${route.name}/${testCase.name}: response body`,
      )
      assert.equal(responseBody.status, undefined)
      assert.equal(responseBody.success, undefined)
      assert.equal(responseBody.r2_prefix, undefined)
      assert.equal(responseBody.image_count, undefined)
    }

    for (const forbidden of [
      "getSupabaseAdmin",
      "createClient",
      "S3Client",
      "PutObjectCommand",
      "ListObjectsV2Command",
      "DeleteObjectCommand",
      "req.formData",
      "req.json",
      "user_loras",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      ".send(",
      'status: "queued"',
      "success: true",
      "r2_prefix",
      "image_count",
    ]) {
      assert.equal(
        routeSource.includes(forbidden),
        false,
        `${route.name}: route contains forbidden source: ${forbidden}`,
      )
    }
  }

  assert.equal(bodyParseCalls, 0, "request bodies are never read or parsed")
  assert.equal(externalFetchCalls, 0, "external fetch is never reached")

  const client = await readFile(
    new URL("../../../app/lora/train/TrainPageClient.tsx", import.meta.url),
    "utf8",
  )
  for (const activeRoute of ["create", "status", "get-upload-urls", "train"]) {
    assert.match(client, new RegExp(`/api/lora/${activeRoute}`))
  }
  assert.doesNotMatch(client, /\/api\/lora\/(start-training|upload-dataset)/)

  const activeRoutes = {
    create: await readFile(
      new URL("../../../app/api/lora/create/route.ts", import.meta.url),
      "utf8",
    ),
    status: await readFile(
      new URL("../../../app/api/lora/status/route.ts", import.meta.url),
      "utf8",
    ),
    uploadUrls: await readFile(
      new URL("../../../app/api/lora/get-upload-urls/route.ts", import.meta.url),
      "utf8",
    ),
    train: await readFile(
      new URL("../../../app/api/lora/train/route.ts", import.meta.url),
      "utf8",
    ),
  }

  assert.match(activeRoutes.create, /ensureActiveSubscription/)
  assert.match(activeRoutes.create, /\.eq\("user_id", userId\)/)
  assert.match(activeRoutes.create, /user_id: userId/)
  assert.match(activeRoutes.status, /ensureActiveSubscription/)
  assert.match(activeRoutes.status, /data\.user_id !== userId/)
  assert.match(activeRoutes.uploadUrls, /ensureActiveSubscription/)
  assert.match(activeRoutes.uploadUrls, /\.eq\("user_id",auth\.user\.id\)/)
  assert.match(activeRoutes.uploadUrls, /getSignedUrl\(r2,/)
  assert.match(activeRoutes.train, /ensureActiveSubscription/)
  assert.match(activeRoutes.train, /lora\.user_id !== userId/)
  assert.doesNotMatch(activeRoutes.train, /\.from\("user_loras"\)[\s\S]*\.update\([\s\S]*status:\s*["']queued["']/)
  assert.match(activeRoutes.train, /TRAINER_EXECUTION_UNAVAILABLE/)
  assert.match(activeRoutes.train, /submit_trainer_compute_job/)

  console.log("LOCK-02D legacy LoRA route containment contract ok")
} finally {
  globalThis.fetch = originalFetch
}
