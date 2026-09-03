import assert from "node:assert/strict"
import test from "node:test"
import { validateCreatorReplyCandidate } from "../../../lib/sirens-mind/creator-reply-validator"
import type { CreatorReplyAuthoritySource } from "../../../lib/sirens-mind/creator-reply"

const sources: CreatorReplyAuthoritySource[] = [
  { id: "profile.key_notes", kind: "key_notes", text: "35, Denver" },
  { id: "current.inbound", kind: "current_inbound", text: "We are in a dark alley. I kneel after you tell me to." },
]
const valid = (text: string, claims: unknown[] = [], authority = sources) =>
  validateCreatorReplyCandidate(text, { version: 4, claims }, authority)

test("accepts natural varied creator-owned prose and strong commands", () => {
  for (const text of [
    "Come closer.",
    "Answer me. I want to hear you say it plainly.",
    "I grin and take one slow step closer to you. Your move.",
    "Careful. I might decide I like testing you.",
  ]) assert.equal(valid(text).ok, true)
})

test("distinguishes creator commands from invented subscriber compliance anywhere in the reply", () => {
  assert.equal(valid("Come closer.").ok, true)
  assert.equal(valid("I grin as you kneel in front of me.").code, "SUBSCRIBER_PUPPETING")
  assert.equal(valid("I wait, watching while you come closer.").code, "SUBSCRIBER_PUPPETING")
  assert.equal(valid("Your hands shake.").code, "SUBSCRIBER_PUPPETING")
})

test("allows conversational questions and requests without treating them as subscriber puppeting", () => {
  for (const text of [
    "You want to know what I want? Good. Listen carefully.",
    "What do you want from me? Say it plainly.",
    "Tell me what you want, and I'll decide what happens next.",
    "Do you feel nervous? Tell me why.",
    "Tell me how you feel before I decide.",
    "I want to know what you want before I choose the next move.",
    "Are you kneeling? Answer me.",
    "Are your hands shaking?",
  ]) assert.equal(valid(text).ok, true, text)
})

test("still rejects declarative invented subscriber actions, preferences, and states", () => {
  for (const text of [
    "You want this.",
    "You think I'm going to make this easy.",
    "You feel nervous.",
    "You decide to stay.",
    "You kneel in front of me.",
    "You're nervous.",
    "Your hands are shaking.",
  ]) assert.equal(valid(text).code, "SUBSCRIBER_PUPPETING", text)
})

test("allows subscriber action only when the exact visible claim is tied to authorized evidence", () => {
  const result = valid("I grin as you kneel in front of me.", [
    { claim: "you kneel", source_id: "current.inbound" },
  ])
  assert.equal(result.ok, true)
})

test("natural paraphrase is allowed while selecting the stable authority record", () => {
  const result = valid("You told me you're in Denver, and I remember.", [
    { claim: "you're in Denver", source_id: "profile.key_notes" },
  ])
  assert.equal(result.ok, true)
})

test("mechanical punctuation, quote, case, and whitespace differences do not reject an otherwise visible claim", () => {
  const result = valid("You told me you’re in Denver — and I remember.", [
    { claim: "YOU TOLD ME YOU'RE IN DENVER, AND I REMEMBER", source_id: "profile.key_notes" },
  ])
  assert.equal(result.ok, true)
})

test("selects a stable authority record without provider-copied evidence", () => {
  const result = valid("You told me you're in Denver.", [
    { claim: "you're in Denver", source_id: "profile.key_notes" },
  ])
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.claims, [{ claim: "you're in Denver", source_id: "profile.key_notes" }])
})

test("normalized claim matching remains lexical rather than semantic", () => {
  assert.equal(valid("You told me you're in Denver.", [
    { claim: "You said you live in Colorado", source_id: "profile.key_notes" },
  ]).code, "CLAIM_NOT_VISIBLE")
})

test("rejects unknown sources, v3/evidence payloads, claims absent from visible prose, and extra metadata", () => {
  assert.equal(valid("I remember Denver.", [{ claim: "Denver", source_id: "missing" }]).code, "UNKNOWN_SOURCE")
  assert.equal(valid("I remember Denver.", [{ claim: "Boston", source_id: "profile.key_notes" }]).code, "CLAIM_NOT_VISIBLE")
  assert.equal(validateCreatorReplyCandidate("Denver.", { version: 3, claims: [{ claim: "Denver", source_id: "profile.key_notes", evidence: "Denver" }] }, sources).code, "MALFORMED_METADATA")
  assert.equal(valid("Denver.", [{ claim: "Denver", source_id: "profile.key_notes", evidence: "Denver" }]).code, "INVALID_CLAIM")
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 4, claims: [], state: {} }, sources).code, "MALFORMED_METADATA")
})

test("rejects unsupported subscriber gender labels and declarative motives or intentions", () => {
  for (const text of [
    "I see you're trying to be a good boy for me tonight.",
    "You're trying to impress me.",
    "You hope I'll go easy on you.",
    "You plan to behave.",
    "Good girl.",
    "You're a woman.",
  ]) assert.equal(valid(text).code, "SUBSCRIBER_PUPPETING", text)
})

test("allows questions, explicit speculation, requests, and conditionals about possible intent", () => {
  for (const text of [
    "Are you trying to distract me?",
    "Maybe you're trying to distract me.",
    "I wonder if you're trying to test me.",
    "If you're trying to test me, keep going.",
    "Tell me what you're trying to do.",
    "Should you decide to test me, you'll find out what happens.",
  ]) assert.equal(valid(text).ok, true, text)
})

test("permits a female identity label when Key Notes is selected as authority", () => {
  const authority: CreatorReplyAuthoritySource[] = [{ id: "profile.key_notes", kind: "key_notes", text: "Subscriber is female. Pronouns: she/her." }]
  assert.equal(valid("Good girl. Keep listening.", [{ claim: "Good girl", source_id: "profile.key_notes" }], authority).ok, true)
  assert.equal(valid("Good boy. Keep listening.", [{ claim: "Good boy", source_id: "profile.key_notes" }], authority).code, "SUBSCRIBER_PUPPETING")
})

test("rejects malformed protocol, hidden leakage, role inversion, and unsupported obvious world props", () => {
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 2, claims: [] }, sources).code, "MALFORMED_METADATA")
  assert.equal(validateCreatorReplyCandidate("<<<SIRENS_FORGE_INTERNAL_META_V1>>>", { version: 4, claims: [] }, sources).code, "SENTINEL_LEAK")
  assert.equal(valid("The creator steps closer.").code, "ROLE_INVERSION")
  assert.equal(valid("I lean against the dumpster and wait.").code, "UNSUPPORTED_WORLD_REFERENCE")
})

test("does not treat creator intent involving the subscriber as invented subscriber state", () => {
  for (const text of ["I want your hands on me.", "I step closer to you.", "When you come closer, I'll decide what happens next."])
    assert.equal(valid(text).ok, true)
})
