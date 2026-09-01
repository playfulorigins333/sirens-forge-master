import assert from "node:assert/strict"
import { mock } from "node:test"
import { RP_META_SENTINEL } from "../../../lib/sirens-mind/admin-rp"

const A = "10000000-0000-4000-8000-00000000000a"
const B = "10000000-0000-4000-8000-00000000000b"
const FOREIGN = "10000000-0000-4000-8000-00000000000c"
let userId = A, providerCalls = 0, providerRequest: any, providerOutput = "Visible", providerError: Error | null = null
const originalFetch = globalThis.fetch
const oldEnv = { ...process.env }
process.env.OPENAI_COMPAT_API_KEY = "test"
process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, { namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: userId } }) } })
mock.module(new URL("../../../lib/sirens-mind/capabilities.ts", import.meta.url).href, { namedExports: { CapabilityCatalogUnavailableError: class extends Error {}, buildCapabilityCatalog: () => "REAL CATALOG" } })
mock.module(new URL("../../../lib/sirens-mind/identities.ts", import.meta.url).href, { namedExports: {
  loadOwnedIdentities: async () => [{ id: A, name: "A", description: "" }, { id: B, name: "B", description: "" }],
  validIdentityId: (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  identityDataMessage: (_items: unknown, active: string | null) => `OWNED IDENTITY REFERENCE ${active}`,
} })

const encoder = new TextEncoder()
globalThis.fetch = async (_input, init) => {
  providerCalls++; providerRequest = JSON.parse(String(init?.body))
  if (providerError) throw providerError
  if (!providerRequest.stream) return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "Normal", handoff: null }) } }] })
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: providerOutput } }] })}\n\ndata: [DONE]\n\n`
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(frame)); controller.close() } }), { headers: { "content-type": "text/event-stream" } })
}

const { POST } = await import(new URL("../../../app/api/sirens-mind/chat/route.ts", import.meta.url).href)
const state = { version: 1, persona: "p", relationship: "r", scene: "s", summary: "sum" }
const handoff = (identity: unknown = "omit") => ({ prompt: "portrait", negative_prompt: null, output_type: "IMAGE", generation_target: "text_to_image", ...(identity === "omit" ? {} : { identity_id: identity }) })
const invoke = (message: string, context: object = {}, continuity?: unknown) => POST(new Request("http://test/api/sirens-mind/chat", { method: "POST", body: JSON.stringify({ mode: "SAFE", message, history: [], context, ...(continuity ? { continuity } : {}) }) }) as any)
const streamText = async (response: Response) => await response.text()

try {
  process.env.SIRENS_MIND_ADMIN_RP_ENABLED = "true"
  process.env.SIRENS_MIND_ADMIN_RP_USER_IDS = A
  process.env.SIRENS_MIND_ADMIN_RP_MODEL = "admin/rp-model"

  userId = FOREIGN; providerCalls = 0
  let response = await invoke("let's roleplay")
  assert.match(response.headers.get("content-type") || "", /application\/json/); assert.equal(providerRequest.stream, undefined); assert.equal(providerRequest.model, "openai/gpt-5-mini"); assert.equal(providerCalls, 1)
  assert.ok(!providerRequest.messages[0].content.includes("INTERNAL ROLEPLAY RUNTIME"))

  userId = A; providerCalls = 0
  response = await invoke("What does roleplay mean?")
  assert.match(response.headers.get("content-type") || "", /application\/json/); assert.equal(providerRequest.stream, undefined); assert.equal(providerCalls, 1)

  providerOutput = `Visible${RP_META_SENTINEL}${JSON.stringify({ state, handoff: null })}`; providerCalls = 0
  response = await invoke("let's roleplay")
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/); assert.equal(providerRequest.stream, true); assert.equal(providerRequest.model, "admin/rp-model"); assert.equal(providerCalls, 1)
  assert.ok(providerRequest.messages[0].content.includes("INTERNAL ROLEPLAY RUNTIME")); assert.match(await streamText(response), /event: continuity/)

  providerOutput = `Still here${RP_META_SENTINEL}{bad`; providerCalls = 0
  response = await invoke("continue", {}, state); let events = await streamText(response)
  assert.match(events, /Still here/); assert.doesNotMatch(events, /event: continuity/); assert.equal(providerCalls, 1)

  providerOutput = `Goodbye${RP_META_SENTINEL}${JSON.stringify({ state: null, handoff: null })}`
  response = await invoke("stop roleplay", {}, state); events = await streamText(response)
  assert.match(events, /event: continuity\ndata: null/)

  providerOutput = `Context${RP_META_SENTINEL}${JSON.stringify({ state, handoff: null })}`
  response = await invoke("let's roleplay", { generation_target: "text_to_image", prompt: "prior prompt", identity_id: A }); await streamText(response)
  assert.ok(!providerRequest.messages[0].content.includes("prior prompt")); assert.ok(providerRequest.messages.some((message: any) => message.role === "user" && message.content.includes("prior prompt")))

  for (const [identity, expected, emitted] of [["omit", A, true], [null, null, true], [B, B, true], [FOREIGN, null, false], ["bad", null, false]] as const) {
    providerCalls = 0
    providerOutput = `Reply survives${RP_META_SENTINEL}${JSON.stringify({ state, handoff: handoff(identity) })}`
    response = await invoke("let's roleplay", { identity_id: A }); events = await streamText(response)
    assert.match(events, /Reply survives/)
    if (emitted) assert.match(events, new RegExp(`event: handoff[\\s\\S]*"identity_id":${expected === null ? "null" : `"${expected}"`}`)); else assert.doesNotMatch(events, /event: handoff/)
    assert.equal(providerCalls, 1)
  }

  providerError = Object.assign(new Error("timed out"), { name: "AbortError" }); providerCalls = 0
  response = await invoke("let's roleplay")
  assert.equal(response.status, 504); assert.deepEqual(await response.json(), { error: "PROMPT_ENGINE_TIMEOUT" }); assert.equal(providerCalls, 1)
  console.log("Phase 6C route behavior: PASS")
} finally {
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
  Object.assign(process.env, oldEnv)
}
