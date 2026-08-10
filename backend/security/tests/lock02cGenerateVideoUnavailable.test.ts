import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

// Run from the repository root with:
// npx tsx backend/security/tests/lock02cGenerateVideoUnavailable.test.ts

const routeUrl = new URL("../../../app/api/generate_video/route.ts", import.meta.url)
const routeSource = await readFile(routeUrl, "utf8")
const originalFetch = globalThis.fetch
let externalFetchCalls = 0

globalThis.fetch = async () => {
  externalFetchCalls += 1
  throw new Error("The unavailable route must not perform external fetches")
}

const { POST } = await import(routeUrl.href)

function request(body?: unknown, includeSession = true) {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (includeSession) headers.set("Cookie", "session=mock-session")

  return new Request("http://localhost/api/generate_video", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const cases = [
  {
    name: "text-to-video",
    request: request({ mode: "text_to_video", prompt: "A lighthouse in a storm" }),
  },
  {
    name: "image-to-video",
    request: request({
      mode: "image_to_video",
      image_input: { filename: "source.png", data_url: "data:image/png;base64,mock" },
    }),
  },
  {
    name: "anonymous",
    request: request({ mode: "text_to_video", prompt: "Anonymous prompt" }, false),
  },
  {
    name: "identity LoRA",
    request: request({
      mode: "text_to_video",
      prompt: "Private identity",
      identity_lora: "private/user-lora.safetensors",
    }),
  },
  { name: "invalid payload", request: request({}) },
  { name: "empty payload", request: request() },
]

try {
  for (const testCase of cases) {
    const response = await POST(testCase.request as any)
    assert.equal(response.status, 503, `${testCase.name}: status`)
    assert.deepEqual(await response.json(), {
      error: "VIDEO_GENERATION_UNAVAILABLE",
      message: "Video generation is currently unavailable.",
    })
  }

  assert.equal(externalFetchCalls, 0, "no mocked external fetch is reached")

  // Source-level containment prevents privileged helpers and fake-success contracts
  // from being silently reintroduced into this disabled route.
  for (const forbidden of [
    "VIDEO_PLACEHOLDER_URL",
    "/videos/placeholder.mp4",
    'status: "completed"',
    "placeholder: true",
    "video_url",
    "outputs",
    "generation_id",
    "createClient",
    "createServerClient",
    "cookies",
    "fetch(",
  ]) {
    assert.equal(routeSource.includes(forbidden), false, `route contains forbidden source: ${forbidden}`)
  }

  console.log("LOCK-02C generate-video unavailable behavioral/security contract ok")
} finally {
  globalThis.fetch = originalFetch
}
