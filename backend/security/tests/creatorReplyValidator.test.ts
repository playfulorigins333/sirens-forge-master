import assert from "node:assert/strict"
import test from "node:test"
import { validateCreatorReplyCandidate } from "../../../lib/sirens-mind/creator-reply-validator"

const validate = (text: string, segments: unknown[], sources = ["Mike, 35, Denver", "quiet mountain lodge", "snowstorm"]) =>
  validateCreatorReplyCandidate(text, { version: 1, segments }, sources)

test("accepts creator-led dialogue, questions, and first-person action", () => {
  for (const text of ["Come closer.", "Are you going to answer me?", "I fold my arms and wait."])
    assert.equal(validate(text, [{ kind: text.startsWith("I ") ? "creator_action" : "dialogue", text }]).ok, true)
})

test("distinguishes a command from narrated subscriber compliance", () => {
  assert.equal(validate("Kneel for me.", [{ kind: "dialogue", text: "Kneel for me." }]).ok, true)
  assert.equal(validate("You kneel for me.", [{ kind: "dialogue", text: "You kneel for me." }]).code, "SECOND_PERSON_NARRATION")
  assert.equal(validate("The subscriber kneels.", [{ kind: "dialogue", text: "The subscriber kneels." }]).code, "SUBSCRIBER_PUPPETING")
})

test("rejects narrator POV, invented physical state, props, occupancy/history, and malformed metadata", () => {
  for (const text of ["You walk toward the door.", "Your heels strike the floor.", "You shiver in your coat."])
    assert.equal(validate(text, [{ kind: "dialogue", text }]).code, "SECOND_PERSON_NARRATION")
  assert.equal(validate("fireplace", [{ kind: "grounded_reference", text: "fireplace", evidence: "fireplace" }]).code, "UNGROUNDED_REFERENCE")
  assert.equal(validate("empty lodge", [{ kind: "grounded_reference", text: "empty lodge", evidence: "empty lodge" }]).code, "UNGROUNDED_REFERENCE")
  assert.equal(validateCreatorReplyCandidate("hello", { state: {} }, []).code, "MALFORMED_METADATA")
})

test("accepts exact grounded Key Notes and environment evidence", () => {
  assert.equal(validate("Mike, 35, Denver", [{ kind: "grounded_reference", text: "Mike, 35, Denver", evidence: "Mike, 35, Denver" }]).ok, true)
  assert.equal(validate("quiet mountain lodge", [{ kind: "grounded_reference", text: "quiet mountain lodge", evidence: "quiet mountain lodge" }]).ok, true)
})

test("rejects hidden leaks, visible mismatch, and provider-authored continuity fields", () => {
  assert.equal(validateCreatorReplyCandidate("<<<SIRENS_FORGE_INTERNAL_META_V1>>>", { version: 1, segments: [{ kind: "dialogue", text: "x" }] }, []).code, "SENTINEL_LEAK")
  assert.equal(validate("hello", [{ kind: "dialogue", text: "different" }]).code, "VISIBLE_MISMATCH")
  assert.equal(validateCreatorReplyCandidate("hello", { version: 1, segments: [{ kind: "dialogue", text: "hello" }], state: { subscriber_persona: "hallucinated" } }, []).code, "MALFORMED_METADATA")
})
