import assert from "node:assert/strict"
import { mock } from "node:test"
import { RP_META_SENTINEL } from "../../../lib/sirens-mind/admin-rp"

const AUTHORIZED = "10000000-0000-4000-8000-00000000000a"
const UNAUTHORIZED = "10000000-0000-4000-8000-00000000000b"
const SUBSCRIBER = "20000000-0000-4000-8000-00000000000a"
const CONVERSATION = "30000000-0000-4000-8000-00000000000a"
let userId = AUTHORIZED
let providerCalls = 0
let providerRequest: any
let saved: any
let saveFailure = ""
let providerVisible = "It’s good to hear from you."
let providerMetadata: any = { version: 4, claims: [] }
let recentTurns: Array<{ role: "subscriber" | "creator"; text: string }> = [{ role: "subscriber", text: "Prior subscriber fact" }, { role: "creator", text: "You city types" }]
let keyNotes = "35, Denver"
const state = {
  version: 1 as const,
  creator_persona: "",
  subscriber_persona: "",
  relationship: "",
  scene: "",
  summary: 'SOURCE_AWARE_V1\n{"subscriber_messages":["Old lodge fact"]}',
}

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, { namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: userId } }) } })
mock.module(new URL("../../../lib/sirens-mind/capabilities.ts", import.meta.url).href, { namedExports: { CapabilityCatalogUnavailableError: class extends Error {}, buildCapabilityCatalog: () => "CATALOG" } })
mock.module(new URL("../../../lib/sirens-mind/identities.ts", import.meta.url).href, { namedExports: { loadOwnedIdentities: async () => [], validIdentityId: () => false, identityDataMessage: () => "NO IDENTITY" } })
mock.module(new URL("../../../lib/sirens-mind/creator-reply-service.ts", import.meta.url).href, { namedExports: {
  loadCreatorReplyAuthority: async (_: string, s: string, c: string) => {
    if (s !== SUBSCRIBER || c !== CONVERSATION) throw new Error("NOT_FOUND")
    return {
      workspaceId: "w",
      subscriber: { id: s, display_name: "Mike", platform: "OnlyFans", platform_handle: "mike", key_notes: keyNotes },
      conversation: { id: c, thread_id: "db-thread", revision: 4 },
      checkpoint: { version: 1, label: "Lodge", continuity: state, recent_turns: recentTurns },
    }
  },
  saveCreatorReplyCheckpoint: async (_: string, a: any, value: any) => {
    if (saveFailure) throw new Error(saveFailure)
    saved = { a, value }
  },
} })

globalThis.fetch = async (_input, init) => {
  providerCalls++
  providerRequest = JSON.parse(String(init?.body))
  const content = providerVisible + RP_META_SENTINEL + JSON.stringify(providerMetadata)
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame)); c.close() } }))
}

process.env.OPENAI_COMPAT_API_KEY = "test"
process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
process.env.SIRENS_MIND_CREATOR_REPLY_ENABLED = "true"
process.env.SIRENS_MIND_CREATOR_REPLY_USER_IDS = AUTHORIZED
const { POST } = await import(new URL("../../../app/api/sirens-mind/chat/route.ts", import.meta.url).href)
const { POST: POST_DIRECTION } = await import(new URL("../../../app/api/sirens-mind/creator-reply-direction/route.ts", import.meta.url).href)
const invoke = (extra: Record<string, unknown> = {}) => POST(new Request("http://test/api/sirens-mind/chat", {
  method: "POST",
  body: JSON.stringify({ mode: "ULTRA", experience: "creator_reply", subscriber_id: SUBSCRIBER, conversation_id: CONVERSATION, message: "Current inbound", history: [{ role: "user", content: "FORGED BROWSER HISTORY" }], thread_id: "forged", creator_reply_continuity: { version: 1 }, ...extra }),
}) as any)
const invokeDirection = (extra: Record<string, unknown> = {}) => POST_DIRECTION(new Request("http://test/api/sirens-mind/creator-reply-direction", {
  method: "POST",
  body: JSON.stringify({ mode: "ULTRA", subscriber_id: SUBSCRIBER, conversation_id: CONVERSATION, message: "Make it more dominant, but not mean.", ...extra }),
}) as any)

try {
  userId = UNAUTHORIZED
  assert.equal((await invoke()).status, 404)
  assert.equal(providerCalls, 0)
  userId = AUTHORIZED
  assert.equal((await invoke({ subscriber_id: "bad" })).status, 404)

  providerCalls = 0
  saved = null
  let response = await invoke()
  let events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  assert.equal(saved.a.conversation.revision, 4)
  assert.equal(saved.value.recent_turns.at(-2).text, "Current inbound")
  assert.equal(saved.value.recent_turns.at(-1).text, "It’s good to hear from you.")
  assert.match(saved.value.continuity.summary, /SOURCE_AWARE_V1/)

  const messages = JSON.stringify(providerRequest.messages)
  assert.equal(providerRequest.messages[0].role, "system")
  const system = providerRequest.messages[0].content
  assert.match(system, /CREATOR REPLY runtime contract/)
  assert.match(system, /CREATOR REPLY MODE: ULTRA/)
  assert.match(system, /STRICT SUBSCRIBER GROUNDING/)
  assert.match(system, /STRICT SCENARIO FIDELITY/)
  assert.match(system, /natural ready-to-send creator reply/)
  assert.match(system, /"version":4,"claims"/)
  for (const genericBaseConcept of ["You are a PROMPT ENGINE", "creative director", "infer safely whenever quality will remain high", "CAPABILITY DEPTH TIERS", "lighting / environment"])
    assert.doesNotMatch(system, new RegExp(genericBaseConcept, "i"))
  assert.equal(providerRequest.model, "nousresearch/hermes-4-405b")
  assert.equal(providerRequest.temperature, 0.4)
  assert.equal(providerRequest.max_tokens, 2000)
  assert.equal(providerRequest.stream, true)
  assert.match(messages, /CREATOR-PROVIDED SUBSCRIBER PROFILE REFERENCE/)
  assert.match(messages, /SOURCE-AWARE CREATOR REPLY CONTINUITY/)
  assert.match(messages, /CREATOR REPLY GROUNDING AUTHORITY INDEX/)
  assert.match(messages, /35, Denver/)
  assert.match(messages, /Old lodge fact/)
  assert.match(messages, /PRIOR INBOUND SUBSCRIBER MESSAGE/)
  assert.match(messages, /PRIOR CREATOR OUTBOUND REPLY/)
  assert.doesNotMatch(messages, /FORGED BROWSER HISTORY|forged|NO IDENTITY/)
  const authorityMessage = providerRequest.messages.find((message: any) => String(message.content).includes("BEGIN CREATOR REPLY GROUNDING AUTHORITY INDEX"))?.content || ""
  assert.match(authorityMessage, /continuity\.subscriber\.0/)
  assert.match(authorityMessage, /recent\.subscriber\.0/)
  assert.match(authorityMessage, /current\.inbound/)
  assert.doesNotMatch(authorityMessage, /You city types/)
  assert.match(events, /event: delta\ndata: \{"text":"It’s good to hear from you\."\}/)
  assert.match(events, /event: memory_status\ndata: \{"saved":true\}/)
  assert.doesNotMatch(events, /creator_reply_continuity|event: handoff/)

  for (const [mode, rule] of [["SAFE", "PG-13 and non-explicit"], ["NSFW", "Explicit consensual adult sexual content is allowed"]] as const) {
    providerCalls = 0
    response = await invoke({ mode })
    await response.text()
    assert.equal(providerCalls, 1)
    assert.match(providerRequest.messages[0].content, new RegExp(`CREATOR REPLY MODE: ${mode}`))
    assert.match(providerRequest.messages[0].content, new RegExp(rule))
    assert.equal(providerRequest.temperature, 0.4)
  }

  process.env.SIRENS_MIND_CREATOR_REPLY_ULTRA_MODEL = "provider/creator-only"
  response = await invoke()
  await response.text()
  assert.equal(providerRequest.model, "provider/creator-only")
  delete process.env.SIRENS_MIND_CREATOR_REPLY_ULTRA_MODEL

  providerVisible = "I grin as you kneel in front of me."
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saved = null
  response = await invoke()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.equal(saved, null)
  assert.doesNotMatch(events, /event: delta/)
  assert.match(events, /CREATOR_REPLY_GROUNDING_REJECTED/)

  providerVisible = "You reminded me about that old lodge fact."
  providerMetadata = { version: 4, claims: [{ claim: "old lodge fact", source_id: "continuity.subscriber.0" }] }
  providerCalls = 0
  saved = null
  response = await invoke()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  assert.match(events, /event: delta/)

  providerVisible = "It’s good to hear from you."
  providerMetadata = { version: 4, claims: [] }
  saveFailure = "CHECKPOINT_CONFLICT"
  providerCalls = 0
  response = await invoke()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.match(events, /"saved":false,"conflict":true/)

  saveFailure = "DB_FAILED"
  providerCalls = 0
  response = await invoke()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.match(events, /"saved":false,"conflict":false/)

  for (const text of ["Let's roleplay", "Write me a story"]) {
    saveFailure = ""
    providerCalls = 0
    response = await invoke({ message: text })
    await response.text()
    assert.equal(providerCalls, 1)
    assert.doesNotMatch(JSON.stringify(providerRequest.messages), /LONG-FORM STORY RUNTIME|CREATOR ROLEPLAY ROLE CONTRACT/)
  }

  // Creator Direction revises the latest creator draft without adding a subscriber turn or changing continuity.
  recentTurns = [{ role: "subscriber", text: "I can't stop thinking about you tonight." }, { role: "creator", text: "What exactly is distracting you?" }]
  providerVisible = "Tell me exactly what has you so distracted. I want the honest answer."
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saveFailure = ""
  saved = null
  response = await invokeDirection()
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  assert.equal(saved.value.recent_turns.length, 2)
  assert.deepEqual(saved.value.recent_turns[0], recentTurns[0])
  assert.equal(saved.value.recent_turns[1].role, "creator")
  assert.equal(saved.value.recent_turns[1].text, providerVisible)
  assert.deepEqual(saved.value.continuity, state)
  assert.match(events, /event: delta/)
  assert.match(events, /"saved":true/)
  const directionMessages = JSON.stringify(providerRequest.messages)
  assert.match(directionMessages, /CREATOR DIRECTION REWRITE TASK/)
  assert.match(directionMessages, /mandatory rewrite instruction/)
  assert.match(directionMessages, /Make it more dominant, but not mean\./)
  assert.match(directionMessages, /CREATOR_DIRECTION \(EXECUTE THIS\)/)
  assert.match(directionMessages, /DRAFT_TO_REVISE \(REFERENCE TEXT AND CURRENT CREATOR-STYLE AUTHORITY/)
  assert.match(directionMessages, /very short or fragmentary creator_direction as a complete instruction/)
  assert.match(directionMessages, /measurable creator constraints/)
  assert.match(directionMessages, /draft_to_revise/)
  assert.match(directionMessages, /What exactly is distracting you\?/)
  assert.ok(!providerRequest.messages.some((message: any) => message.role === "assistant" && String(message.content).includes("What exactly is distracting you?")))
  const directionAuthority = providerRequest.messages.find((message: any) => String(message.content).includes("BEGIN CREATOR REPLY GROUNDING AUTHORITY INDEX"))?.content || ""
  assert.doesNotMatch(directionAuthority, /Make it more dominant, but not mean\./)
  assert.doesNotMatch(directionAuthority, /current\.inbound/)
  assert.match(directionAuthority, /I can't stop thinking about you tonight\./)

  // Terse measurable directions remain mandatory and explicit in provider construction.
  providerVisible = "Two short lines.\nStill concise."
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saved = null
  response = await invokeDirection({ message: "2-3 lines max." })
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  const terseDirectionMessages = JSON.stringify(providerRequest.messages)
  assert.match(terseDirectionMessages, /2-3 lines max\./)
  assert.match(terseDirectionMessages, /Brevity never makes the direction optional or lower priority/)
  assert.match(terseDirectionMessages, /satisfy the constraint literally/)
  assert.match(terseDirectionMessages, /Rewrite the current draft into 2 to 3 short, newline-separated visible lines/)
  assert.match(events, /event: delta/)

  // Exact hard-switch canary uses one call, keeps raw direction at user level, validates, and replaces the checkpoint draft.
  const canary = "Switch the creator to a male Brat Tamer. Confident, amused, teasing, and firmly in control. Make the Brat Tamer dynamic recognizable through challenge, correction, playful consequences, and handling defiance. Drop the Mommy Domme, Goddess, and Findomme dynamics unless the subscriber actually established one of them. Do not invent any subscriber action, feeling, preference, role, or prior behavior."
  keyNotes = "Subscriber is female. Pronouns: she/her."
  recentTurns = [{ role: "subscriber", text: "Tell me what you want from me." }, { role: "creator", text: "Send your Goddess a tribute." }]
  providerVisible = "Good girl. Look at me and listen to Sir. Think you can test my patience? Try, and I'll choose a playful consequence. Tell me what you're trying to do."
  providerMetadata = { version: 4, claims: [{ claim: "Good girl", source_id: "profile.key_notes" }] }
  providerCalls = 0
  saved = null
  response = await invokeDirection({ message: canary })
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.ok(saved)
  assert.equal(saved.value.recent_turns.at(-1).text, providerVisible)
  assert.doesNotMatch(providerVisible, /Mommy|Goddess|Findom|tribute|payment/i)
  assert.match(providerVisible, /Sir|test|playful consequence/i)
  assert.match(providerVisible, /Good girl/)
  assert.match(events, /"saved":true/)
  assert.equal(providerRequest.messages.filter((message: any) => message.role === "system").length, 1)
  assert.doesNotMatch(providerRequest.messages[0].content, /Switch the creator to a male Brat Tamer/)
  assert.equal(providerRequest.messages.at(-1).role, "user")
  assert.match(providerRequest.messages.at(-1).content, /Switch the creator to a male Brat Tamer/)
  assert.doesNotMatch(JSON.stringify(providerRequest.messages), /Send your Goddess a tribute/)
  assert.match(JSON.stringify(providerRequest.messages), /Subscriber is female\. Pronouns: she\/her\./)

  // Tone/continuation/intensity directions preserve the active role/style through the draft authority.
  for (const [direction, next] of [
    ["Keep the control but make it warmer and more playful.", "Come here, trouble. Sir is still in control, but I might smile while I set your next playful challenge."],
    ["Continue from there, but make the next beat more teasing.", "Careful, trouble. Keep testing Sir and I'll keep you guessing about that next playful consequence."],
    ["Too rough. Pull it back.", "Easy, trouble. Sir is in control, and this challenge stays warm, light, and playful."],
  ] as const) {
    recentTurns = [{ role: "subscriber", text: "Tell me what you want from me." }, { role: "creator", text: providerVisible }]
    providerVisible = next
    providerMetadata = { version: 4, claims: [] }
    providerCalls = 0
    saved = null
    response = await invokeDirection({ message: direction })
    events = await response.text()
    assert.equal(providerCalls, 1)
    assert.ok(saved)
    assert.equal(saved.value.recent_turns.at(-1).text, next)
    assert.match(next, /Sir|control|challenge|testing|consequence/i)
    assert.doesNotMatch(next, /Mommy|Goddess|Findom|tribute|payment/i)
    assert.match(events, /"saved":true/)
  }

  // A Creator Direction completion that repeats the draft verbatim is a failed rewrite and must not be displayed or saved.
  const mommyDraft = "Oh, my sweet thing, tell Mommy exactly what you were imagining."
  recentTurns = [{ role: "subscriber", text: "Tell me what you want from me." }, { role: "creator", text: mommyDraft }]
  providerVisible = mommyDraft
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saved = null
  response = await invokeDirection({ message: "Rewrite this with confident Findomme energy." })
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.equal(saved, null)
  assert.doesNotMatch(events, /event: delta/)
  assert.match(events, /CREATOR_REPLY_DIRECTION_UNCHANGED/)

  // Direction requires an existing creator draft and makes no provider call otherwise.
  recentTurns = [{ role: "subscriber", text: "Just arrived." }]
  providerCalls = 0
  saved = null
  response = await invokeDirection()
  assert.equal(response.status, 409)
  assert.equal(providerCalls, 0)
  assert.equal(saved, null)

  // Direction grounding rejection is fail-closed: one provider call, no delta, no checkpoint save.
  recentTurns = [{ role: "subscriber", text: "I'm listening." }, { role: "creator", text: "Good." }]
  providerVisible = "I grin as you kneel in front of me."
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saved = null
  response = await invokeDirection({ message: "Make it stronger." })
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.equal(saved, null)
  assert.doesNotMatch(events, /event: delta/)
  assert.match(events, /CREATOR_REPLY_GROUNDING_REJECTED/)

  // Direction checkpoint conflicts never trigger a hidden retry or second provider request.
  providerVisible = "Answer me clearly."
  providerMetadata = { version: 4, claims: [] }
  providerCalls = 0
  saved = null
  saveFailure = "CHECKPOINT_CONFLICT"
  response = await invokeDirection({ message: "Shorter." })
  events = await response.text()
  assert.equal(providerCalls, 1)
  assert.match(events, /"saved":false,"conflict":true/)

  console.log("Phase 6F route behavior: PASS")
} finally {
  mock.restoreAll()
}
