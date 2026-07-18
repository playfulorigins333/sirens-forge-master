import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { getPublicAutopostPlatforms, normalizeKnownPlatformIds } from "../../../lib/autopost/platformRegistry"

const client = () => readFileSync("app/autopost/AutopostPageClient.tsx", "utf8")
const orchestration = () => readFileSync("app/autopost/Task14AutopostOrchestration.tsx", "utf8")

test("creator-facing launch catalog is exactly X, Reddit, OnlyFans, and Fanvue", () => {
  const platforms = getPublicAutopostPlatforms()
  assert.deepEqual(platforms.map((platform) => platform.id), ["fanvue", "onlyfans", "x", "reddit"])
  assert.deepEqual(new Set(platforms.map((platform) => platform.id)), new Set(["fanvue", "onlyfans", "x", "reddit"]))
  assert.equal(platforms.some((platform) => ["fansly", "loyalfans", "justforfans"].includes(platform.id)), false)
})

test("autopost launch UI filters fallback, cards, new selections, and messaging to four launch platforms", () => {
  const src = client()
  const fallback = src.slice(src.indexOf("const FALLBACK_PLATFORMS"), src.indexOf("const AUTOPOST_PACK_PREFILL_STORAGE_KEY"))
  const platformTab = src.slice(src.indexOf("Launch Platforms"), src.indexOf("{/* Approve Modal */"))
  const selector = src.slice(src.indexOf("{/* Platforms */"), src.indexOf("{/* Frequency */"))

  assert.match(fallback, /id: "x"/)
  assert.match(fallback, /id: "reddit"/)
  assert.match(fallback, /id: "onlyfans"/)
  assert.match(fallback, /id: "fanvue"/)
  for (const removed of ["fansly", "loyalfans", "justforfans", "Fansly", "LoyalFans", "JustForFans"]) {
    assert.doesNotMatch(fallback, new RegExp(removed))
    assert.doesNotMatch(platformTab, new RegExp(removed))
    assert.doesNotMatch(selector, new RegExp(removed))
  }
  assert.match(platformTab, /Traffic & Discovery/)
  assert.match(platformTab, /Paid Content/)
  assert.match(platformTab, /ids: \["x", "reddit"\]/)
  assert.match(platformTab, /ids: \["onlyfans", "fanvue"\]/)
  assert.match(platformTab, /Open OnlyFans Publishing Queue/)
  assert.match(src, /return "TRAFFIC CHANNEL"/)
  assert.match(src, /return "ASSISTED PUBLISHING"/)
  assert.match(src, /return "FROZEN"/)
  assert.match(src, /Promote your paid content and direct followers to OnlyFans or Fanvue\./)
  assert.match(src, /Reach relevant communities and direct interested audiences to your paid page\./)
  assert.match(src, /Prepare and complete posts through the assisted Creator Publishing Queue\./)
  assert.match(src, /Paid-content publishing remains unavailable while safety restrictions are in place\./)
  assert.doesNotMatch(platformTab, /section\.title[\s\S]*rounded-full border border-cyan-300\/30 bg-cyan-300\/10 px-3 py-1/)
  assert.doesNotMatch(platformTab, /platformUnavailableMessage\(p\)/)
  assert.match(platformTab, /href="\/creator\/publishing-queue"/)
  assert.doesNotMatch(platformTab, /href="\/creator\/publishing-queue"[^>]+target=/)
  assert.match(platformTab, /target="_blank" rel="noopener noreferrer"/)
  assert.match(src, /return "Open X"/)
  assert.match(src, /return "Open Reddit"/)
  assert.match(src, /return "Open OnlyFans"/)
  assert.match(src, /return "Open Fanvue"/)
  assert.doesNotMatch(platformTab, /Open platform/)
  assert.match(src, /assisted\/manual publishing/)
})

test("legacy platform ids remain displayable while not entering new creator launch UI", () => {
  assert.deepEqual(normalizeKnownPlatformIds(["fansly", "loyalfans", "justforfans", "x"]), ["fansly", "loyalfans", "justforfans", "x"])
  const src = client()
  assert.match(src, /fansly: "Fansly"/)
  assert.match(src, /loyalfans: "LoyalFans"/)
  assert.match(src, /justforfans: "JustForFans"/)
})

test("publishing-plan section is readable and creator-facing instead of task-number branded", () => {
  const src = orchestration()
  assert.match(src, /Creator publishing workflow/)
  assert.match(src, /bg-slate-950\/90/)
  assert.match(src, /text-slate-200/)
  assert.match(src, /border-cyan-300\/30/)
  assert.match(src, /disabled:bg-slate-700/)
  assert.doesNotMatch(src, /Task 14 Creator Publishing Orchestration/)
  assert.doesNotMatch(src, /\["onlyfans","fansly","fanvue"\]/)
})
