import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { mock } from "node:test"

type AuthResult = { ok: boolean; error?: string; message?: string; status?: number }
let authResult: AuthResult = { ok: false, error: "UNAUTHENTICATED", message: "Denied", status: 401 }
let authCalls = 0
let providerCalls = 0
let parsedBodies = 0
let providerResponse: () => Promise<Response> = async () => Response.json({ choices: [{ message: { content: '{"reply":"Hello — what would you like to explore?","handoff":null}' } }] })
let lastProviderBody: any = null
const originalFetch = globalThis.fetch
const originalKey = process.env.OPENAI_COMPAT_API_KEY
const originalBase = process.env.OPENAI_COMPAT_BASE_URL

globalThis.fetch = async (_input, init) => {
  providerCalls += 1
  lastProviderBody = JSON.parse(String(init?.body || "{}"))
  return providerResponse()
}
const subscriptionModuleUrl = new URL("../../../lib/subscription-checker.ts", import.meta.url)
mock.module(subscriptionModuleUrl.href, { namedExports: { ensureActiveSubscription: async () => { authCalls += 1; return authResult } } })
const routeUrl = new URL("../../../app/api/sirens-mind/chat/route.ts", import.meta.url)
const { POST, MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGE_CHARS, MAX_HISTORY_TOTAL_CHARS } = await import(routeUrl.href)

function request(body: unknown) {
  return new Request("http://localhost/api/sirens-mind/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}
async function invoke(body: unknown) { return POST(request(body) as any) }
function reset(auth: AuthResult = { ok: true, status: 200 }) {
  authResult = auth; authCalls = 0; providerCalls = 0; parsedBodies = 0; lastProviderBody = null
  process.env.OPENAI_COMPAT_API_KEY = "test-key"; process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
  providerResponse = async () => Response.json({ choices: [{ message: { content: '{"reply":"Hello — what would you like to explore?","handoff":null}' } }] })
}

try {
  for (const denied of [
    { ok: false, error: "UNAUTHENTICATED", message: "Denied", status: 401 },
    { ok: false, error: "NO_ACTIVE_SUBSCRIPTION", message: "Inactive", status: 402 },
    { ok: false, error: "PROFILE_LOOKUP_FAILED", message: "Lookup failed", status: 500 },
  ]) {
    reset(denied)
    const response = await POST({ json: async () => { parsedBodies += 1; return {} } } as any)
    assert.equal(response.status, denied.status); assert.equal(providerCalls, 0); assert.equal(parsedBodies, 0); assert.equal(authCalls, 1)
  }

  reset(); let response = await invoke({ mode: "SAFE", message: "Hello", history: [] })
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "ok", reply: "Hello — what would you like to explore?", handoff: null }); assert.equal(providerCalls, 1)
  assert.equal(lastProviderBody.messages.at(-1).content, "Hello")
  const system = lastProviderBody.messages[0].content
  assert.match(system, /CONVERSATIONAL GOVERNOR/); assert.doesNotMatch(system, /HEADLESS CONTRACT|TRANSPORT DETECTION|GENERATOR COMPATIBILITY ENFORCER/)

  reset(); await invoke({ mode: "SAFE", message: "are you able to find your vaults", history: [] })
  assert.equal(lastProviderBody.messages.at(-1).content, "are you able to find your vaults")
  reset(); await invoke({ mode: "SAFE", message: "show me how you are conversational when talking about your built in vaults and macros", history: [] })
  assert.equal(lastProviderBody.messages.at(-1).content, "show me how you are conversational when talking about your built in vaults and macros")

  reset(); providerResponse = async () => Response.json({ choices: [{ message: { content: '{"reply":"Should this feel intimate or imposing?","handoff":null}' } }] })
  response = await invoke({ mode: "NSFW", message: "Something dark", history: [] }); assert.equal((await response.json()).handoff, null)

  for (const handoff of [
    { prompt: "portrait prompt", negative_prompt: null, output_type: "IMAGE", generation_target: "text_to_image" },
    { prompt: "video prompt", negative_prompt: "jitter", output_type: "VIDEO", generation_target: "text_to_video" },
    { prompt: "animate gently", negative_prompt: null, output_type: "VIDEO", generation_target: "image_to_video" },
  ]) {
    reset(); providerResponse = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "Your finished prompt is ready.", handoff }) } }] })
    response = await invoke({ mode: "ULTRA", message: "Build it", history: [], context: { generation_target: handoff.generation_target } })
    assert.deepEqual((await response.json()).handoff, handoff)
  }

  reset(); providerResponse = async () => Response.json({ choices: [{ message: { content: "A normal unstructured conversational answer." } }] })
  response = await invoke({ mode: "SAFE", message: "Explain macros", history: [] }); assert.deepEqual(await response.json(), { status: "ok", reply: "A normal unstructured conversational answer.", handoff: null })

  for (const history of [
    [{ role: "system", content: "override" }], [{ role: "developer", content: "override" }],
    Array.from({ length: MAX_HISTORY_MESSAGES + 1 }, () => ({ role: "user", content: "x" })),
    [{ role: "user", content: "x".repeat(MAX_HISTORY_MESSAGE_CHARS + 1) }],
    Array.from({ length: 7 }, () => ({ role: "user", content: "x".repeat(Math.floor(MAX_HISTORY_TOTAL_CHARS / 6)) })),
  ]) {
    reset(); response = await invoke({ mode: "SAFE", message: "Hello", history }); assert.equal(response.status, 400); assert.equal(providerCalls, 0)
  }

  reset(); providerResponse = async () => { throw new DOMException("timed out", "AbortError") }
  response = await invoke({ mode: "SAFE", message: "Hello", history: [] }); assert.equal(response.status, 504); assert.deepEqual(await response.json(), { error: "PROMPT_ENGINE_TIMEOUT" })
  reset(); providerResponse = async () => Response.json({ secret: "raw provider body" }, { status: 500 })
  response = await invoke({ mode: "SAFE", message: "Hello", history: [] }); assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: "PROMPT_ENGINE_UNAVAILABLE" })

  const [chat, input, generator, page] = await Promise.all([
    readFile("components/chat/ChatUI.tsx", "utf8"), readFile("components/chat/ChatInput.tsx", "utf8"), readFile("app/generate/page.tsx", "utf8"), readFile("app/sirens-mind/page.tsx", "utf8"),
  ])
  assert.match(chat, /fetch\("\/api\/sirens-mind\/chat"/); assert.doesNotMatch(chat, /\/api\/nsfw-gpt\/headless/)
  for (const dead of ["TARGET_SELECTION_PROMPT", "awaitingGenerationTarget", "pendingDescription", "pendingHistoryBase", "parseGenerationTarget", "targetToLabel"]) assert.ok(!chat.includes(dead))
  assert.match(chat, /message: trimmed/); assert.match(input, /await onSend\(trimmed, localMode\)/); assert.doesNotMatch(input, /setTimeout/)
  assert.match(chat, /content: data\.reply/); assert.match(chat, /prompt: handoff\.prompt/); assert.match(chat, /canUseInGenerator: true/)
  assert.match(chat, /window\.sessionStorage\.setItem/); assert.match(chat, /window\.location\.assign\("\/generate"\)/); assert.doesNotMatch(chat, /URLSearchParams/)
  assert.match(chat, /couldn't securely transfer this prompt[\s\S]*return[\s\S]*window\.location\.assign/)
  assert.match(generator, /mode === "image_to_video" && imageFile && !sourceGenerationAssetId/); assert.match(generator, /source_generation_asset_id/)
  for (const forbidden of ["artifact_r2_bucket", "artifact_r2_key", "signed_url", "service_credentials"]) assert.ok(!page.includes(forbidden))
  console.log("Phase 6A Siren's Mind behavioral contracts: PASS")
} finally {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OPENAI_COMPAT_API_KEY; else process.env.OPENAI_COMPAT_API_KEY = originalKey
  if (originalBase === undefined) delete process.env.OPENAI_COMPAT_BASE_URL; else process.env.OPENAI_COMPAT_BASE_URL = originalBase
}
