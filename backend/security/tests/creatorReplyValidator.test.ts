import assert from "node:assert/strict"
import test from "node:test"
import { validateCreatorReplyCandidate } from "../../../lib/sirens-mind/creator-reply-validator"
import type { CreatorReplyAuthoritySource } from "../../../lib/sirens-mind/creator-reply"

const sources: CreatorReplyAuthoritySource[] = [
  { id: "profile.key_notes", kind: "key_notes", text: "35, Denver" },
  { id: "current.inbound", kind: "current_inbound", text: "We are in a dark alley. I kneel after you tell me to." },
]
const valid = (text: string, claims: unknown[] = [], authority = sources) =>
  validateCreatorReplyCandidate(text, { version: 3, claims }, authority)

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

test("allows subscriber action only when the exact visible claim is tied to authorized evidence", () => {
  const result = valid("I grin as you kneel in front of me.", [
    { claim: "you kneel", source_id: "current.inbound", evidence: "I kneel" },
  ])
  assert.equal(result.ok, true)
})

test("natural paraphrase is allowed while evidence remains exact source text", () => {
  const result = valid("You told me you're in Denver, and I remember.", [
    { claim: "you're in Denver", source_id: "profile.key_notes", evidence: "Denver" },
  ])
  assert.equal(result.ok, true)
})

test("rejects unknown sources, invented evidence, claims absent from visible prose, and extra metadata", () => {
  assert.equal(valid("I remember Denver.", [{ claim: "Denver", source_id: "missing", evidence: "Denver" }]).code, "UNKNOWN_SOURCE")
  assert.equal(valid("I remember Denver.", [{ claim: "Denver", source_id: "profile.key_notes", evidence: "Boston" }]).code, "UNGROUNDED_EVIDENCE")
  assert.equal(valid("I remember Denver.", [{ claim: "Boston", source_id: "profile.key_notes", evidence: "Denver" }]).code, "CLAIM_NOT_VISIBLE")
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 3, claims: [], state: {} }, sources).code, "MALFORMED_METADATA")
})

test("rejects malformed protocol, hidden leakage, role inversion, and unsupported obvious world props", () => {
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 2, claims: [] }, sources).code, "MALFORMED_METADATA")
  assert.equal(validateCreatorReplyCandidate("<<<SIRENS_FORGE_INTERNAL_META_V1>>>", { version: 3, claims: [] }, sources).code, "SENTINEL_LEAK")
  assert.equal(valid("The creator steps closer.").code, "ROLE_INVERSION")
  assert.equal(valid("I lean against the dumpster and wait.").code, "UNSUPPORTED_WORLD_REFERENCE")
})

test("does not treat creator intent involving the subscriber as invented subscriber state", () => {
  for (const text of ["I want your hands on me.", "I step closer to you.", "When you come closer, I'll decide what happens next."])
    assert.equal(valid(text).ok, true)
})
