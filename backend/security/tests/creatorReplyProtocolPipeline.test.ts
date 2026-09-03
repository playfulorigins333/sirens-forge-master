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

async function parseAndValidate(visible: string, metadata: unknown) {
  let buffered = ""
  const sentinelStart = visible.length
  const result = await consumeProviderSse(
    streamedCompletion(visible, metadata, [5, sentinelStart + 4, sentinelStart + RP_META_SENTINEL.length - 3, sentinelStart + RP_META_SENTINEL.length + 7]),
    (text) => { buffered += text },
  )
  return { buffered, validation: validateCreatorReplyCandidate(buffered, result.metadata, authority) }
}

test("streamed Creator Reply pipeline accepts creator-owned Brat Tamer language with no claims", async () => {
  const visible = "Come closer and look at me. Think you can test me? Try it, and I'll decide what playful consequence you earn."
  const result = await parseAndValidate(visible, { version: 3, claims: [] })
  assert.equal(result.buffered, visible)
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline accepts an exact anchored grounded subscriber assertion", async () => {
  const visible = "You knelt when I asked. Good. Now tell me what you want."
  const result = await parseAndValidate(visible, { version: 3, claims: [
    { claim: "You knelt when I asked", source_id: "current.inbound", evidence: "I knelt when you asked" },
  ] })
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline tolerates only mechanical anchor and evidence normalization", async () => {
  const visible = "You said you’re in Denver — I remember."
  const result = await parseAndValidate(visible, { version: 3, claims: [
    { claim: "YOU SAID YOU'RE IN DENVER, I REMEMBER", source_id: "current.inbound", evidence: "I LIVE IN DENVER" },
  ] })
  assert.equal(result.validation.ok, true)
})

test("streamed pipeline fails closed for non-visible anchors and invented subscriber facts", async () => {
  const absent = await parseAndValidate("Answer me plainly.", { version: 3, claims: [
    { claim: "You are eager", source_id: "current.inbound", evidence: "I knelt" },
  ] })
  assert.equal(absent.validation.code, "CLAIM_NOT_VISIBLE")

  const invented = await parseAndValidate("You tremble when I challenge you.", { version: 3, claims: [] })
  assert.equal(invented.validation.code, "SUBSCRIBER_PUPPETING")
})
