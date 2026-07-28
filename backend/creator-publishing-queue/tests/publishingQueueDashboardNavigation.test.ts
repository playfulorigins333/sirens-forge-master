import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const source = fs.readFileSync("app/creator/publishing-queue/page.tsx", "utf8")
const actionRow = source.match(/<div className="mt-5 flex flex-wrap gap-3">([\s\S]*?)<\/div><Section/)?.[1]

test("queue root permanently renders Dashboard first in its wrapping top action row", () => {
  assert.ok(actionRow, "expected the permanent top action row before queue sections")
  assert.match(actionRow, /<Link href="\/dashboard"[^>]*>Dashboard<\/Link>/)
  assert.ok(actionRow.indexOf("Dashboard") < actionRow.indexOf("Create publishing package"))
  assert.doesNotMatch(actionRow, /\?|&&|\|\||\.map\(|items|view\./)
})

test("queue root preserves existing actions, sections, and external-posting statement", () => {
  for (const href of [
    "/creator/publishing-queue/new",
    "/creator/publishing-queue/accounts",
    "/creator/publishing-queue/ai-twin-consent",
  ]) assert.match(actionRow!, new RegExp(`href="${href}"`))

  for (const title of [
    "Awaiting your approval",
    "Approved",
    "Rejected",
    "Ready for manual handoff",
    "Scheduled internally",
    "Read-only status",
  ]) assert.match(source, new RegExp(`title="${title}"`))

  assert.match(source, /This interface never posts to external platforms and never writes protected approval fields directly from the browser\./)
})
