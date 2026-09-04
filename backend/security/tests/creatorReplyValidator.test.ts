import assert from "node:assert/strict"
import test from "node:test"
import { validateCreatorReplyCandidate } from "../../../lib/sirens-mind/creator-reply-validator"
import type { CreatorReplyAuthoritySource } from "../../../lib/sirens-mind/creator-reply"

const sources: CreatorReplyAuthoritySource[] = [
  { id: "profile.key_notes", kind: "key_notes", text: "35, Denver" },
  { id: "current.inbound", kind: "current_inbound", text: "We are in a dark alley. I kneel after you tell me to." },
]
const valid = (text: string, claims: unknown[] = [], authority = sources) =>
  validateCreatorReplyCandidate(text, { version: 5, claims }, authority)

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

test("allows subscriber action only when the exact visible claim selects an authoritative source", () => {
  const result = valid("I grin as you kneel in front of me.", [
    { claim: "you kneel", authority_id: "current.inbound.unit.1" },
  ])
  assert.equal(result.ok, true)
})

test("natural paraphrase is allowed through a stable server-built authority reference", () => {
  const result = valid("You told me you're in Denver, and I remember.", [
    { claim: "in Denver", authority_id: "profile.key_notes.unit.0" },
  ])
  assert.equal(result.ok, true)
})

test("mechanical punctuation, quote, case, and whitespace differences do not reject an otherwise visible claim", () => {
  const result = valid("You told me you’re in Denver — and I remember.", [
    { claim: "IN DENVER", authority_id: "profile.key_notes.unit.0" },
  ])
  assert.equal(result.ok, true)
})

test("normalized claim matching remains lexical rather than semantic", () => {
  assert.equal(valid("You told me you're in Denver.", [
    { claim: "You said you live in Colorado", authority_id: "profile.key_notes.unit.0" },
  ]).code, "CLAIM_NOT_VISIBLE")
})

test("rejects unknown sources, legacy evidence fields, claims absent from visible prose, and extra metadata", () => {
  assert.equal(valid("I remember Denver.", [{ claim: "Denver", authority_id: "missing" }]).code, "UNKNOWN_SOURCE")
  assert.equal(valid("I remember Denver.", [{ claim: "Denver", authority_id: "profile.key_notes.unit.0", evidence: "Denver" }]).code, "INVALID_CLAIM")
  assert.equal(valid("I remember Denver.", [{ claim: "Boston", authority_id: "profile.key_notes.unit.0" }]).code, "CLAIM_NOT_VISIBLE")
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 5, claims: [], state: {} }, sources).code, "MALFORMED_METADATA")
})

test("rejects malformed protocol, hidden leakage, role inversion, and unsupported obvious world props", () => {
  assert.equal(validateCreatorReplyCandidate("Hello.", { version: 2, claims: [] }, sources).code, "MALFORMED_METADATA")
  assert.equal(validateCreatorReplyCandidate("<<<SIRENS_FORGE_INTERNAL_META_V1>>>", { version: 5, claims: [] }, sources).code, "SENTINEL_LEAK")
  assert.equal(valid("The creator steps closer.").code, "ROLE_INVERSION")
  assert.equal(valid("I lean against the dumpster and wait.").code, "UNSUPPORTED_WORLD_REFERENCE")
})

test("does not treat creator intent involving the subscriber as invented subscriber state", () => {
  for (const text of ["I want your hands on me.", "I step closer to you.", "When you come closer, I'll decide what happens next."])
    assert.equal(valid(text).ok, true)
})

test("rejects unsupported declarative subscriber motives while allowing questions, speculation, and conditions", () => {
  for (const text of [
    "I see you're trying to be a good boy for me tonight.",
    "You're trying to impress me.",
    "You hope I'll go easy on you.",
    "You plan to behave.",
    "You are hoping to win me over.",
    "You intend to test me.",
    "You're intending to distract me.",
    "You're planning to behave.",
    "You mean to provoke me.",
    "You want to impress me.",
  ]) assert.equal(valid(text).code, "SUBSCRIBER_PUPPETING", text)

  for (const text of [
    "Are you trying to distract me?",
    "Maybe you're trying to distract me.",
    "I wonder if you're trying to test me.",
    "If you're trying to test me, keep going.",
    "Tell me what you're trying to do.",
    "Should you decide to test me, you'll find out what happens.",
  ]) assert.equal(valid(text).ok, true, text)
})

test("requires subscriber authority for factual gendered labels", () => {
  for (const text of ["Good boy.", "Good girl.", "You're a man.", "You're a woman.", "My princess."])
    assert.equal(valid(text).code, "SUBSCRIBER_PUPPETING", text)

  const femaleNotes: CreatorReplyAuthoritySource[] = [
    { id: "profile.key_notes", kind: "key_notes", text: "Subscriber is female. Pronouns: she/her." },
  ]
  assert.equal(valid("Good girl.", [{ claim: "Good girl", authority_id: "profile.key_notes.unit.0" }], femaleNotes).ok, true)
})

test("a valid but unrelated female identity authority cannot ground another subscriber fact", () => {
  const femaleNotes: CreatorReplyAuthoritySource[] = [
    { id: "profile.key_notes", kind: "key_notes", text: "Subscriber is female. Pronouns: she/her." },
  ]
  for (const text of ["Look who's eager.", "You're wealthy.", "You're nervous.", "You love this.", "You've paid before.", "You're trying to impress me."]) {
    const result = valid(text, [{ claim: text.replace(/\.$/, ""), authority_id: "profile.key_notes.unit.0" }], femaleNotes)
    assert.equal(result.code, "UNGROUNDED_EVIDENCE", text)
  }
})

test("covers omitted-auxiliary motives without rejecting questions, speculation, or conditions", () => {
  for (const text of ["You trying to tell me what to do.", "You trying to impress me.", "You hoping I'll go easy on you.", "You planning to behave."])
    assert.equal(valid(text).code, "SUBSCRIBER_PUPPETING", text)
  for (const text of ["Are you eager?", "Maybe you're eager.", "I wonder if you're eager.", "Are you trying to tell me what to do?", "Maybe you're trying to tell me what to do.", "If you're trying to test me, keep going.", "Can't stop thinking about me, can you?", "Think you're up for it?", "Tell me what you're trying to do."])
    assert.equal(valid(text).ok, true, text)
})

test("preserves subscriber and creator roles instead of grounding reversed relationships", () => {
  const source = (text: string): CreatorReplyAuthoritySource[] => [{ id: "current.inbound", kind: "current_inbound", text }]
  const claim = [{ claim: "You want me", authority_id: "current.inbound.unit.0" }]
  assert.equal(valid("You want me.", claim, source("Tell me what you want from me.")).code, "UNGROUNDED_EVIDENCE")
  assert.equal(valid("You want me.", claim, source("I want you.")).ok, true)
})

test("preserves polarity for states and subject-object facts", () => {
  const source = (text: string): CreatorReplyAuthoritySource[] => [{ id: "current.inbound", kind: "current_inbound", text }]
  assert.equal(valid("You are wealthy.", [{ claim: "You are wealthy", authority_id: "current.inbound.unit.0" }], source("I am not wealthy.")).code, "UNGROUNDED_EVIDENCE")
  assert.equal(valid("You are not wealthy.", [{ claim: "You are not wealthy", authority_id: "current.inbound.unit.0" }], source("I am not wealthy.")).ok, true)
  assert.equal(valid("You want this.", [{ claim: "You want this", authority_id: "current.inbound.unit.0" }], source("I do not want this.")).code, "UNGROUNDED_EVIDENCE")
  assert.equal(valid("You do not want this.", [{ claim: "You do not want this", authority_id: "current.inbound.unit.0" }], source("I do not want this.")).ok, true)
})

test("does not turn incidental third-party pronouns into subscriber identity", () => {
  const thirdParty: CreatorReplyAuthoritySource[] = [{ id: "current.inbound", kind: "current_inbound", text: "I bought her a gift." }]
  assert.equal(valid("Good girl.", [{ claim: "Good girl", authority_id: "current.inbound.unit.0" }], thirdParty).code, "UNGROUNDED_EVIDENCE")
})

test("normalizes straight and curly contractions while retaining negation", () => {
  const source = (text: string): CreatorReplyAuthoritySource[] => [{ id: "current.inbound", kind: "current_inbound", text }]
  for (const [inbound, outbound, expected] of [
    ["I'm nervous.", "You're nervous.", true],
    ["I’m nervous.", "You’re nervous.", true],
    ["I'm not nervous.", "You're nervous.", false],
    ["I’m not nervous.", "You’re nervous.", false],
    ["I'm not nervous.", "You're not nervous.", true],
    ["I’m not nervous.", "You’re not nervous.", true],
    ["I've paid before.", "You've paid before.", true],
    ["I’ve paid before.", "You’ve paid before.", true],
    ["I can't wait.", "You can't wait.", true],
    ["I can’t wait.", "You can’t wait.", true],
    ["I won't wait.", "You will wait.", false],
    ["I won’t wait.", "You won’t wait.", true],
  ] as const) {
    const result = valid(outbound, [{ claim: outbound.slice(0, -1), authority_id: "current.inbound.unit.0" }], source(inbound))
    assert.equal(result.ok, expected, `${inbound} -> ${outbound}`)
    if (!expected) assert.equal(result.code, "UNGROUNDED_EVIDENCE")
  }
})
