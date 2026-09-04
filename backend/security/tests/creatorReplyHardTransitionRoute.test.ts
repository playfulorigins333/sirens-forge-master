import assert from "node:assert/strict"
import { mock } from "node:test"
import { RP_META_SENTINEL } from "../../../lib/sirens-mind/admin-rp"

const USER = "10000000-0000-4000-8000-00000000000a"
const SUBSCRIBER = "20000000-0000-4000-8000-00000000000a"
const CONVERSATION = "30000000-0000-4000-8000-00000000000a"
const CANARY = "Switch the creator to a male Brat Tamer. Confident, amused, teasing, and firmly in control. Make the Brat Tamer dynamic recognizable through challenge, correction, playful consequences, and handling defiance. Drop the Mommy Domme, Goddess, and Findomme dynamics unless the subscriber actually established one of them. Do not invent any subscriber action, feeling, preference, role, or prior behavior."

let providerCalls = 0
let providerVisible = "Think you can handle a challenge? Try me. Sir decides what happens next."
let providerMetadata: unknown = { version: 5, claims: [] }
let saved: unknown = null

const continuity = {
  version: 1 as const,
  creator_persona: "",
  subscriber_persona: "",
  relationship: "",
  scene: "",
  summary: 'SOURCE_AWARE_V1\n{"subscriber_messages":["Tell me what you want from me."]}',
}
const recentTurns = [
  { role: "subscriber" as const, text: "Tell me what you want from me." },
  { role: "creator" as const, text: "Send your Goddess a tribute." },
]

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, {
  namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: USER } }) },
})
mock.module(new URL("../../../lib/sirens-mind/creator-reply-service.ts", import.meta.url).href, {
  namedExports: {
    loadCreatorReplyAuthority: async () => ({
      workspaceId: "w",
      subscriber: {
        id: SUBSCRIBER,
        display_name: "Canary Test",
        platform: "OnlyFans",
        platform_handle: null,
        key_notes: "Subscriber is female. Pronouns: she/her.",
      },
      conversation: { id: CONVERSATION, thread_id: "db-thread", revision: 7 },
      checkpoint: { version: 1, label: "Canary", continuity, recent_turns: recentTurns },
    }),
    saveCreatorReplyCheckpoint: async (_userId: string, _authority: unknown, value: unknown) => { saved = value },
  },
})

globalThis.fetch = async (_input, init) => {
  providerCalls++
  const body = JSON.parse(String(init?.body))
  assert.equal(body.model, "nousresearch/hermes-4-405b")
  assert.equal(body.temperature, 0.4)
  const content = providerVisible + RP_META_SENTINEL + JSON.stringify(providerMetadata)
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame)); controller.close() } }))
}

process.env.OPENAI_COMPAT_API_KEY = "test"
process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
process.env.SIRENS_MIND_CREATOR_REPLY_ENABLED = "true"
process.env.SIRENS_MIND_CREATOR_REPLY_USER_IDS = USER

const { POST } = await import(new URL("../../../app/api/sirens-mind/creator-reply-direction/route.ts", import.meta.url).href)
const invoke = () => POST(new Request("http://test/api/sirens-mind/creator-reply-direction", {
  method: "POST",
  body: JSON.stringify({ mode: "ULTRA", subscriber_id: SUBSCRIBER, conversation_id: CONVERSATION, message: CANARY }),
}) as any)

try {
  // A valid hard-switch reply must not fail because Hermes emitted irrelevant/bad grounding bookkeeping.
  // The route validates hard-transition visible prose with an empty claim set because this operation is fact-free.
  providerVisible = "Think you can handle a challenge? Try me. Sir decides what happens next."
  providerMetadata = {
    version: 5,
    claims: [{ claim: "look who's eager", authority_id: "profile.key_notes.unit.0" }],
  }
  providerCalls = 0
  saved = null
  let response = await invoke()
  let events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  assert.match(events, /event: delta/)
  assert.match(events, /"saved":true/)
  assert.doesNotMatch(events, /CREATOR_REPLY_GROUNDING_REJECTED/)

  // Ignoring hard-transition metadata must NOT weaken visible subscriber-agency guards.
  providerVisible = "Well, look who's eager. Try me."
  providerMetadata = { version: 5, claims: [] }
  providerCalls = 0
  saved = null
  response = await invoke()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.equal(saved, null)
  assert.doesNotMatch(events, /event: delta/)
  assert.match(events, /CREATOR_REPLY_GROUNDING_REJECTED/)

  console.log("Creator Reply hard-transition route regression: PASS")
} finally {
  mock.restoreAll()
}
