import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

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
const emptyModule = "data:text/javascript,export%20{}"
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: ${JSON.stringify(emptyModule)}, shortCircuit: true }
  if (specifier === "next/server") return { url: ${JSON.stringify(nextServerModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}
`)}`, import.meta.url)

const route = await import("../../../app/api/autopost/platforms/reddit/route.ts")
const { getAutopostPlatformRegistry } = await import("../../../lib/autopost/platformRegistry.ts")
const { buildUserPlatformStatus } = await import("../../../lib/autopost/platformAvailability.ts")
const { getCreatorPublishingPlatformPolicy, listCreatorPublishingPlatformPolicies } = await import("../../../lib/creator-publishing-queue/policies/index.ts")

const POST_BODY = {
  ok: false,
  platform: "reddit",
  status: "NOT_CONFIGURED",
  error_code: "REDDIT_NATIVE_POSTING_NOT_CONFIGURED",
  error_message: "Reddit native posting is not configured. No provider request or post was attempted.",
  provider_request_attempted: false,
  post_attempted: false,
  retry_attempted: false,
  database_write_attempted: false,
  outcome_uncertain: false,
}
const GET_BODY = {
  ...POST_BODY,
  status: "METHOD_NOT_ALLOWED",
  error_code: "METHOD_NOT_ALLOWED",
  error_message: "POST only.",
}
const AUTHORIZED_KEYS = Object.keys(POST_BODY).sort()
const FORBIDDEN_SUCCESS_FIELDS = [
  "workflow_task_id", "platform_post_id", "external_job_id", "provider_post_id",
  "reddit_post_id", "ready_for_assisted_posting",
]

async function test(name: string, action: () => unknown | Promise<unknown>) {
  await action()
  process.stdout.write(`ok - ${name}\n`)
}
function result(response: any) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: response.body }
}
function assertPost(response: any) {
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(response.body, POST_BODY)
  assert.deepEqual(Object.keys(response.body).sort(), AUTHORIZED_KEYS)
}

await test("real POST is exact, fail-closed, no-store, and deterministic", () => {
  const first = route.POST(new Request("https://example.invalid/reddit", { method: "POST", body: "{}" }))
  const second = route.POST(new Request("https://elsewhere.invalid/path?ignored=1", { method: "POST", headers: { Authorization: "ignored" }, body: "malformed{" }))
  assertPost(first)
  assertPost(second)
  assert.deepEqual(result(first), result(second))
})

await test("POST ignores malformed, one-byte, whitespace, large, header, query, and URL variants", () => {
  for (const [url, body, headers] of [
    ["https://example.invalid/", "{", {}],
    ["https://example.invalid/?query=changed", "x", { "x-test": "changed" }],
    ["https://different.invalid/other", "   ", {}],
    ["https://another.invalid/", "x".repeat(1_000_000), {}],
  ] as const) assertPost(route.POST(new Request(url, { method: "POST", body, headers })))
})

await test("POST never accesses poison body or reader", () => {
  const counts = { body_getter_calls: 0, get_reader_calls: 0, read_calls: 0, pull_calls: 0, cancel_calls: 0 }
  const poisonGetter = { get body() { counts.body_getter_calls++; throw new Error("body accessed") } } as any
  assertPost(route.POST(poisonGetter))
  const poisonReader = { body: { getReader() { counts.get_reader_calls++; throw new Error("reader accessed") } } } as any
  assertPost(route.POST(poisonReader))
  assert.deepEqual(counts, { body_getter_calls: 0, get_reader_calls: 0, read_calls: 0, pull_calls: 0, cancel_calls: 0 })
})

await test("POST never pulls, reads, or cancels stalled and rejecting streams", () => {
  const counts = { body_getter_calls: 0, get_reader_calls: 0, read_calls: 0, pull_calls: 0, cancel_calls: 0 }
  for (const stream of [
    new ReadableStream({ pull() { counts.pull_calls++; return new Promise(() => {}) }, cancel() { counts.cancel_calls++ } }),
    new ReadableStream({ pull(controller) { counts.pull_calls++; controller.error(new Error("must not pull")) }, cancel() { counts.cancel_calls++ } }),
  ]) {
    const original = stream.getReader.bind(stream)
    Object.defineProperty(stream, "getReader", { value() {
      counts.get_reader_calls++
      const reader = original()
      const read = reader.read.bind(reader)
      Object.defineProperty(reader, "read", { value() { counts.read_calls++; return read() } })
      return reader
    } })
    assertPost(route.POST({ body: stream } as any))
  }
  assert.deepEqual(counts, { body_getter_calls: 0, get_reader_calls: 0, read_calls: 0, pull_calls: 0, cancel_calls: 0 })
})

await test("real GET is exact, method-not-allowed, no-store, deterministic, and inert", () => {
  const first = route.GET()
  const second = route.GET()
  for (const response of [first, second]) {
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(response.body, GET_BODY)
    assert.deepEqual(Object.keys(response.body).sort(), AUTHORIZED_KEYS)
    for (const key of ["provider_request_attempted", "post_attempted", "retry_attempted", "database_write_attempted", "outcome_uncertain"] as const) assert.equal(response.body[key], false)
  }
  assert.deepEqual(result(first), result(second))
})

await test("runtime and source contain no fake success or generated identifier", () => {
  const source = readFileSync("app/api/autopost/platforms/reddit/route.ts", "utf8")
  for (const response of [route.POST({} as any), route.GET()]) {
    assert.equal(response.body.ok, false)
    for (const field of FORBIDDEN_SUCCESS_FIELDS) assert.equal(field in response.body, false)
    for (const value of Object.values(response.body)) if (typeof value === "string") {
      assert.doesNotMatch(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      assert.doesNotMatch(value, /\b1[0-9]{9}(?:[0-9]{3})?\b/)
      assert.doesNotMatch(value, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      assert.doesNotMatch(value, /^(?:reddit|t[1-6])_[a-z0-9]{6,}$/)
    }
  }
  for (const field of FORBIDDEN_SUCCESS_FIELDS) assert.doesNotMatch(source, new RegExp(field))
})

await test("route source has no provider, OAuth, token, database, environment, or randomness capability", () => {
  const source = readFileSync("app/api/autopost/platforms/reddit/route.ts", "utf8")
  for (const forbidden of [
    "fetch\\(", "globalThis\\.fetch", "node-fetch", "axios", "undici", "Supabase", "createClient",
    "getSupabaseAdmin", "process\\.env", "Authorization", "Bearer", "client_id", "client_secret",
    "access_token", "refresh_token", "oauth\\.reddit\\.com", "www\\.reddit\\.com/api", "reddit\\.com/api/v1",
    "/api/submit", "/api/v1/me", "Date\\.now", "Math\\.random", "randomUUID", "crypto\\.randomUUID",
  ]) assert.doesNotMatch(source, new RegExp(forbidden, "i"))
  const routeImports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), match => match[1])
  assert.deepEqual(routeImports, ["next/server"])
  for (const forbidden of ["fanvue", "onlyfans", "xadapter", "xtokenrefresh", "xlivetextcanary", "xcontrolledrefresh", "scheduler", "queue", "jobresults", "jobproof"])
    assert.equal(routeImports.some(path => path.replaceAll("\\", "/").toLowerCase().includes(forbidden)), false)
})

await test("Reddit registry and availability remain locked", () => {
  delete process.env.AUTOPOST_WEBHOOK_REDDIT
  const reddit = getAutopostPlatformRegistry().find(platform => platform.id === "reddit")
  assert.ok(reddit)
  assert.equal(reddit.public_selectable, false)
  assert.equal(reddit.supports_real_posting, false)
  const availability = buildUserPlatformStatus(reddit, new Map())
  for (const key of ["can_connect", "public_selectable", "can_schedule", "supports_real_posting", "supports_text_posting", "supports_media_posting"] as const) assert.equal(availability[key], false)
  assert.equal((availability as any).native_posting_available ?? false, false)
})

await test("runner excludes Reddit and remains gated only to X", () => {
  const source = readFileSync("app/api/autopost/run/route.ts", "utf8")
  assert.doesNotMatch(source, /from ["'][^"']*reddit/i)
  assert.doesNotMatch(source, /platforms\/reddit|reddit\.com|oauth\.reddit/i)
  assert.match(source, /return \["x"\]/)
  assert.match(source, /env\.AUTOPOST_X_RUN_DISPATCH_ENABLED === "true"/)
  assert.equal(source.match(/AUTOPOST_X_RUN_DISPATCH_ENABLED/g)?.length, 1)
})

await test("Creator Publishing Queue leaves Reddit unavailable and unassigned", () => {
  assert.throws(() => getCreatorPublishingPlatformPolicy("reddit" as any), /policy is not configured for platform: reddit/)
  assert.equal(listCreatorPublishingPlatformPolicies().some(policy => (policy.platform as string) === "reddit"), false)
})

await test("Fanvue, OnlyFans, and X locks remain unchanged", () => {
  const registry = getAutopostPlatformRegistry()
  const fanvue = registry.find(platform => platform.id === "fanvue")!
  const onlyfans = registry.find(platform => platform.id === "onlyfans")!
  const x = registry.find(platform => platform.id === "x")!
  assert.equal(fanvue.public_selectable, false)
  assert.equal(fanvue.supports_real_posting, false)
  assert.equal(onlyfans.supports_assisted_workflow, true)
  assert.equal(onlyfans.supports_real_posting, false)
  assert.equal(x.public_selectable, false)
  assert.equal(buildUserPlatformStatus(x, new Map()).can_schedule, false)
  assert.notEqual(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED, "true")
})

console.log("Reddit placeholder lockdown tests passed")
