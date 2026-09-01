import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import path from "node:path"
import { shouldActivateLongformStory } from "../../../lib/sirens-mind/story"
import { buildBoundedChatHistory, CHAT_HISTORY_MAX_MESSAGE_CHARS, CHAT_HISTORY_MAX_TOTAL_CHARS } from "../../../lib/sirens-mind/chat-history"
import { createTextBatcher } from "../../../lib/sirens-mind/stream-batcher"

test("long-form story activation is explicit and conservative", () => {
  for (const message of ["Write me a 2,000-word story about adults.", "Write a complete short story.", "Write this as a full story.", "Write me a 2–3 page story.", "Write Chapter 2.", "Continue the story.", "Continue this chapter.", "Turn this into a complete prose story."]) assert.equal(shouldActivateLongformStory(message), true, message)
  for (const message of ["How do I write a story?", "Help me brainstorm a story.", "Give me story ideas.", "What makes a good erotic story?", "Can we discuss the plot?", "Hello"]) assert.equal(shouldActivateLongformStory(message), false, message)
  for (const message of ["Write a story outline.", "Create a story prompt.", "Give me chapter titles.", "Write a story summary."]) assert.equal(shouldActivateLongformStory(message), false, message)
  assert.equal(shouldActivateLongformStory("Give me a story outline, then write the complete prose story."), true)
  assert.equal(shouldActivateLongformStory("Give me story ideas, then write the complete prose story."), true)
})

test("rapid stream deltas are coalesced in exact order and final text flushes", () => {
  const scheduled: Array<() => void> = [], commits: string[] = []
  const batcher = createTextBatcher((text) => commits.push(text), (callback) => { scheduled.push(callback); return callback }, () => {})
  batcher.append("one"); batcher.append(" two"); batcher.append(" three")
  assert.deepEqual(commits, []); assert.equal(scheduled.length, 1)
  batcher.flush(); assert.deepEqual(commits, ["one two three"])
  batcher.append(" final"); batcher.flush(); assert.equal(commits.join(""), "one two three final")
  batcher.dispose(); batcher.append(" ignored"); assert.equal(commits.join(""), "one two three final")
})

test("normal, RP, and story paths retain distinct timeout controllers", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/api/sirens-mind/chat/route.ts"), "utf8")
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), PROVIDER_TIMEOUT_MS\)/)
  assert.match(source, /setTimeout\(abort, LONGFORM_STORY_STREAM_TIMEOUT_MS\)/)
  assert.match(source, /setTimeout\(abort, RP_STREAM_TIMEOUT_MS\)/)
})

test("history bounds long story tails while retaining the most recent setup", () => {
  const items = Array.from({ length: 30 }, (_, index) => ({ id: `old-${index}`, role: (index % 2 ? "assistant" : "user") as "user" | "assistant", content: `old-${index}-` + "x".repeat(3000) }))
  items.push({ id: "setup", role: "user", content: "Recent mountain cabin setup" })
  items.push({ id: "story", role: "assistant", content: "discarded beginning " + "s".repeat(9000) + " RECENT STORY TAIL" })
  items.push({ id: "error", role: "assistant", content: "error", isError: true } as any)
  const history = buildBoundedChatHistory(items)
  assert.ok(history.length <= 24)
  assert.ok(history.every((entry) => entry.content.length <= CHAT_HISTORY_MAX_MESSAGE_CHARS))
  assert.ok(history.reduce((total, entry) => total + entry.content.length, 0) <= CHAT_HISTORY_MAX_TOTAL_CHARS)
  assert.ok(history.some((entry) => entry.content.includes("Recent mountain cabin setup")))
  assert.ok(history.at(-1)?.content.endsWith("RECENT STORY TAIL"))
  assert.ok(!history.some((entry) => entry.content.includes("discarded beginning")))
})
