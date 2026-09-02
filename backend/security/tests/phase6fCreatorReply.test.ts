import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import path from "node:path"
import { creatorReplyAuthorized, fallbackCreatorReplyContinuity, inboundSubscriberMessage, outboundCreatorReply, parseCreatorReplyContinuity, validCreatorReplyThreadId, CREATOR_REPLY_CONTINUITY_PREFIX, CREATOR_REPLY_THREAD_KEY } from "../../../lib/sirens-mind/creator-reply"

test("authorization is explicit, enabled, UUID validated, and allowlisted", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000"
  assert.equal(creatorReplyAuthorized(id, { SIRENS_MIND_CREATOR_REPLY_ENABLED: "true", SIRENS_MIND_CREATOR_REPLY_USER_IDS: id }), true)
  assert.equal(creatorReplyAuthorized(id, { SIRENS_MIND_CREATOR_REPLY_ENABLED: "false", SIRENS_MIND_CREATOR_REPLY_USER_IDS: id }), false)
  assert.equal(creatorReplyAuthorized(id, { SIRENS_MIND_CREATOR_REPLY_ENABLED: "true", SIRENS_MIND_CREATOR_REPLY_USER_IDS: "not-a-uuid" }), false)
})

test("raw subscriber turns and complete history receive ownership wrappers", () => {
  const raw = "I brush the snow off my coat and look over at you."
  assert.match(inboundSubscriberMessage(raw), /BEGIN INBOUND SUBSCRIBER MESSAGE/)
  assert.match(inboundSubscriberMessage(raw), new RegExp(raw.replaceAll(".", "\\.")))
  assert.match(inboundSubscriberMessage(raw, true), /PRIOR INBOUND SUBSCRIBER MESSAGE/)
  assert.match(outboundCreatorReply("Come inside."), /PRIOR CREATOR OUTBOUND REPLY/)
  assert.doesNotMatch(raw, /SUBSCRIBER MESSAGE:/)
})

test("continuity is versioned, bounded, and control-character safe", () => {
  const valid = { version: 1, creator_persona: "bartender", subscriber_persona: "traveler", relationship: "tension", scene: "lodge", summary: "snowstorm" }
  assert.deepEqual(parseCreatorReplyContinuity(valid), valid)
  assert.equal(parseCreatorReplyContinuity({ ...valid, summary: "x".repeat(3501) }), null)
  assert.equal(parseCreatorReplyContinuity({ ...valid, scene: "bad\u0000state" }), null)
  assert.equal(parseCreatorReplyContinuity({ ...valid, extra: "no" }), null)
})

test("fallback labels ownership correctly", () => {
  const state = fallbackCreatorReplyContinuity(null, "I enter.", "I look up.")
  assert.match(state.summary, /Subscriber: I enter\./)
  assert.match(state.summary, /Creator Reply: I look up\./)
  assert.doesNotMatch(state.summary, /Creator: I enter\./)
})

test("thread IDs and storage namespace are isolated", () => {
  assert.equal(validCreatorReplyThreadId(crypto.randomUUID()), true)
  assert.notEqual(crypto.randomUUID(), crypto.randomUUID())
  assert.match(CREATOR_REPLY_THREAD_KEY, /creator_reply_thread/)
  assert.match(CREATOR_REPLY_CONTINUITY_PREFIX, /creator_reply_continuity:/)
  assert.notEqual(CREATOR_REPLY_THREAD_KEY, "sirensforge:sirens_mind_internal_continuity")
})

test("production prompt defines both pronoun directions and agency", () => {
  const prompt = fs.readFileSync(path.join(process.cwd(), "prompts/nsfw_gpt/nsfw_gpt.creator_reply.system.txt"), "utf8")
  assert.match(prompt, /I\/me\/my\/mine means the SUBSCRIBER/)
  assert.match(prompt, /you\/your\/yours means the CREATOR/)
  assert.match(prompt, /I\/me\/my\/mine means the CREATOR/)
  assert.match(prompt, /you\/your\/yours means the SUBSCRIBER/)
  assert.match(prompt, /"You are X".*creator's role/)
  assert.match(prompt, /"I am X".*subscriber's role/)
  assert.match(prompt, /never invent new subscriber dialogue/)
})

test("workspace is hidden and configured without generator or billing UX", () => {
  const ui = fs.readFileSync(path.join(process.cwd(), "components/chat/ChatUI.tsx"), "utf8")
  const message = fs.readFileSync(path.join(process.cwd(), "components/chat/ChatMessage.tsx"), "utf8")
  const page = fs.readFileSync(path.join(process.cwd(), "app/sirens-mind/replies/page.tsx"), "utf8")
  assert.match(page, /creatorReplyAuthorized/)
  assert.match(page, /notFound\(\)/)
  assert.match(ui, /experience="creator_reply"|experience === "creator_reply"/)
  assert.match(ui, /Paste subscriber message\.\.\./)
  assert.match(ui, /New Subscriber/)
  assert.match(message, /Copy Reply/)
  assert.doesNotMatch(page, /billing|upgrade|entitlement/i)
})
