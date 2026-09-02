import assert from "node:assert/strict"
import { mock } from "node:test"
import { RP_STREAM_TIMEOUT_MS } from "../../../lib/sirens-mind/admin-rp"

const USER = "10000000-0000-4000-8000-00000000000a"
const NON_ADMIN = "10000000-0000-4000-8000-00000000000b"
let userId = USER, providerCalls = 0, providerRequest: any
const logs: string[] = []
const originalFetch = globalThis.fetch, originalInfo = console.info
const oldEnv = { ...process.env }
process.env.OPENAI_COMPAT_API_KEY = "test"
process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
process.env.SIRENS_MIND_ADMIN_RP_ENABLED = "true"
process.env.SIRENS_MIND_ADMIN_RP_USER_IDS = USER
process.env.SIRENS_MIND_ADMIN_RP_MODEL = "admin/rp-model"

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, { namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: userId } }) } })
mock.module(new URL("../../../lib/sirens-mind/capabilities.ts", import.meta.url).href, { namedExports: { CapabilityCatalogUnavailableError: class extends Error {}, buildCapabilityCatalog: (mode: string) => `PRIVATE ${mode} CATALOG` } })
mock.module(new URL("../../../lib/sirens-mind/identities.ts", import.meta.url).href, { namedExports: {
  loadOwnedIdentities: async () => [{ id: USER, name: "Private Name", description: "Private DNA" }], validIdentityId: () => true,
  identityDataMessage: () => "PRIVATE IDENTITY REFERENCE",
} })
console.info = (...args: unknown[]) => { logs.push(args.map(String).join(" ")) }
globalThis.fetch = async (_input, init) => {
  providerCalls++; providerRequest = JSON.parse(String(init?.body))
  if (!providerRequest.stream) return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "Normal", handoff: null }) } }] })
  const frames = `data: ${JSON.stringify({ choices: [{ delta: { content: "Finished prose" } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\ndata: [DONE]\n\n`
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frames)); controller.close() } }))
}

const { POST, PROVIDER_TIMEOUT_MS, LONGFORM_STORY_STREAM_TIMEOUT_MS, maxDuration } = await import(new URL("../../../app/api/sirens-mind/chat/route.ts", import.meta.url).href)
const invoke = (message: string, mode = "SAFE", continuity?: object) => POST(new Request("http://test/api/sirens-mind/chat", { method: "POST", body: JSON.stringify({ mode, message, history: [], ...(continuity ? { continuity } : {}) }) }) as any)

try {
  assert.equal(PROVIDER_TIMEOUT_MS, 20_000); assert.equal(RP_STREAM_TIMEOUT_MS, 60_000); assert.equal(LONGFORM_STORY_STREAM_TIMEOUT_MS, 240_000); assert.equal(maxDuration, 300)
  providerCalls = 0
  let response = await invoke("Hello")
  assert.match(response.headers.get("content-type") || "", /application\/json/)
  assert.equal(providerRequest.max_tokens, 2000); assert.equal(providerRequest.stream, undefined); assert.equal(providerCalls, 1)

  providerCalls = 0
  response = await invoke("Write this scene as a 2,000-word story.", "NSFW", { version: 1, persona: "p", relationship: "r", scene: "s", summary: "secret", role_contract: "STORY-MUST-NOT-SEE-THIS-CONTRACT" })
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/)
  assert.equal(providerRequest.max_tokens, 5000); assert.equal(providerRequest.stream, true); assert.equal(providerRequest.model, "openai/gpt-4o"); assert.equal(providerCalls, 1)
  assert.match(providerRequest.messages[0].content, /LONG-FORM STORY RUNTIME/); assert.doesNotMatch(providerRequest.messages[0].content, /INTERNAL ROLEPLAY RUNTIME/)
  const continuityMessages = providerRequest.messages.filter((message: any) => message.content.includes("secret"))
  assert.equal(continuityMessages.length, 1); assert.equal(continuityMessages[0].role, "user"); assert.ok(!providerRequest.messages[0].content.includes("secret"))
  const providerMessages = JSON.stringify(providerRequest.messages)
  assert.doesNotMatch(providerMessages, /CREATOR ROLEPLAY ROLE CONTRACT|STORY-MUST-NOT-SEE-THIS-CONTRACT|role_contract/)
  const events = await response.text()
  assert.match(events, /event: delta[\s\S]*Finished prose[\s\S]*event: done/); assert.doesNotMatch(events, /event: (?:handoff|continuity)/)
  assert.doesNotMatch(events, /PRIVATE|LONG-FORM STORY RUNTIME/)
  const storyLog = JSON.parse(logs.at(-1)!)
  assert.equal(storyLog.interactionClass, "story"); assert.equal(storyLog.handoffProduced, false); assert.equal(storyLog.providerTotalTokens, 30)
  assert.doesNotMatch(logs.at(-1)!, /Finished prose|Private Name|Private DNA|PRIVATE .*CATALOG/)

  userId = NON_ADMIN; providerCalls = 0
  response = await invoke("Write me a 2,000-word story about two adults.", "ULTRA", { version: 1, persona: "p", relationship: "r", scene: "s", summary: "non-admin secret" })
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/)
  assert.equal(providerRequest.max_tokens, 5000); assert.equal(providerRequest.model, "nousresearch/hermes-4-405b"); assert.equal(providerCalls, 1)
  assert.doesNotMatch(providerRequest.messages[0].content, /INTERNAL ROLEPLAY RUNTIME/)
  assert.ok(!providerRequest.messages.some((message: any) => message.content.includes("non-admin secret"))); await response.text()

  userId = USER
  response = await invoke("Let's roleplay."); assert.match(response.headers.get("content-type") || "", /text\/event-stream/); assert.equal(providerRequest.model, "admin/rp-model"); await response.text()
  console.log = originalInfo
  console.log("Phase 6D route behavior: PASS")
} finally {
  globalThis.fetch = originalFetch; console.info = originalInfo
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
  Object.assign(process.env, oldEnv)
}
