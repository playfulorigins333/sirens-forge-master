import assert from "node:assert/strict"
import test from "node:test"
import { consumeProviderSse, RP_META_SENTINEL } from "../../../lib/sirens-mind/admin-rp"
import { validateCreatorReplyCandidate } from "../../../lib/sirens-mind/creator-reply-validator"
import type { CreatorReplyAuthoritySource } from "../../../lib/sirens-mind/creator-reply"

const authority: CreatorReplyAuthoritySource[] = [
  { id: "current.inbound", kind: "current_inbound", text: "I knelt when you asked, and I live in Denver." },
]

function streamedCompletion(visible: string, metadata: unknown, cuts: number[]) {
  const content = visible + RP_META_SENTINEL + JSON.stringify(metadata)
  const pieces: string[] = []
  let at = 0
  for (const cut of cuts) { pieces.push(content.slice(at, cut)); at = cut }
  pieces.push(content.slice(at))
  const frames = pieces.map((piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
  frames.push("data: [DONE]\n\n")
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame))
      controller.close()
    },
  })
}

async function parseAndValidate(visible: string, metadata: unknown, sources = authority) {
  let buffered = ""
  const sentinelStart = visible.length
  const result = await consumeProviderSse(
    streamedCompletion(visible, metadata, [5, sentinelStart + 4, sentinelStart + RP_META_SENTINEL.length - 3, sentinelStart + RP_META_SENTINEL.length + 7]),
    (text) => { buffered += text },
  )
  return { buffered, validation: validateCreatorReplyCandidate(buffered, result.metadata, sources) }
}

test("streamed Creator Reply pipeline accepts creator-owned Brat Tamer language with no claims", async () => {
  const visible = "Come closer and look at me. Think you can test me? Try it, and I'll decide what playful consequence you earn."
  const result = await parseAndValidate(visible, { version: 4, claims: [] })
  assert.equal(result.buffered, visible)
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline accepts an exact anchored grounded subscriber assertion", async () => {
  const visible = "You knelt when I asked. Good. Now tell me what you want."
  const result = await parseAndValidate(visible, { version: 4, claims: [
    { claim: "You knelt when I asked", source_id: "current.inbound" },
  ] })
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline tolerates only mechanical visible-anchor normalization", async () => {
  const visible = "You said you’re in Denver — I remember."
  const result = await parseAndValidate(visible, { version: 4, claims: [
    { claim: "YOU SAID YOU'RE IN DENVER, I REMEMBER", source_id: "current.inbound" },
  ] })
  assert.equal(result.validation.ok, true)
})

test("female Key Notes and a male Brat Tamer completion cross chunk boundaries without evidence copying", async () => {
  const femaleNotes: CreatorReplyAuthoritySource[] = [
    { id: "profile.key_notes", kind: "key_notes", text: "Subscriber is female. Pronouns: she/her." },
  ]
  const visible = "Good girl. Listen to Sir: test me if you dare, and I'll choose a playful consequence. Tell me what you're trying to do."
  const result = await parseAndValidate(visible, { version: 4, claims: [
    { claim: "Good girl", source_id: "profile.key_notes" },
  ] }, femaleNotes)
  assert.equal(result.buffered, visible)
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline rejects legacy v3 and malformed v4 authority references", async () => {
  const legacy = await parseAndValidate("You said you're in Denver.", { version: 3, claims: [
    { claim: "you're in Denver", source_id: "current.inbound", evidence: "Denver" },
  ] })
  assert.equal(legacy.validation.code, "MALFORMED_METADATA")

  const extra = await parseAndValidate("You said you're in Denver.", { version: 4, claims: [
    { claim: "you're in Denver", source_id: "current.inbound", evidence: "Denver" },
  ] })
  assert.equal(extra.validation.code, "INVALID_CLAIM")
})

test("streamed pipeline fails closed for non-visible anchors and invented subscriber facts", async () => {
  const absent = await parseAndValidate("Answer me plainly.", { version: 4, claims: [
    { claim: "You are eager", source_id: "current.inbound" },
  ] })
  assert.equal(absent.validation.code, "CLAIM_NOT_VISIBLE")

  const invented = await parseAndValidate("You tremble when I challenge you.", { version: 4, claims: [] })
  assert.equal(invented.validation.code, "SUBSCRIBER_PUPPETING")
})
