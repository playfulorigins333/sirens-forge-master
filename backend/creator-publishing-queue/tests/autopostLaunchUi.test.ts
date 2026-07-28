import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { getPublicAutopostPlatforms, normalizeKnownPlatformIds } from "../../../lib/autopost/platformRegistry"

const client = () => readFileSync("app/autopost/AutopostPageClient.tsx", "utf8")
const generate = () => readFileSync("app/generate/page.tsx", "utf8")
const orchestration = () => readFileSync("app/autopost/Task14AutopostOrchestration.tsx", "utf8")
const page = () => readFileSync("app/autopost/page.tsx", "utf8")

test("Autopost provides persistent Dashboard navigation without changing launch safeguards", () => {
  const src = client()
  const headerStart = src.indexOf("{/* Header */}")
  const mainStart = src.indexOf("{/* Main */}")

  assert.match(src, /import Link from "next\/link"/)
  assert.ok(headerStart >= 0)
  assert.ok(mainStart > headerStart)

  const header = src.slice(headerStart, mainStart)
  assert.match(header, /<Button\s+asChild\s+variant="outline"[\s\S]*?<Link href="\/dashboard">[\s\S]*?Dashboard[\s\S]*?<\/Link>[\s\S]*?<\/Button>/)
  assert.ok(src.indexOf('<Link href="/dashboard">') < mainStart)
  assert.doesNotMatch(header, /\{tab === [^}]+&& \([\s\S]*?<Link href="\/dashboard">/)

  assert.match(header, /My Rules/)
  assert.match(header, /Build Rule/)
  assert.match(header, /Platforms/)
  assert.match(src, /if \(platform\.id === "reddit"\) return "MANUAL ONLY"/)
  assert.match(src, /if \(platform\.id === "reddit"\) return "Open Reddit"/)
  assert.match(src, /const selectable = isPlatformSelectable\(p\)/)
  assert.match(src, /disabled=\{!selectable\}/)
})

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
  assert.match(src, /platform\.id === "x"\) return "TRAFFIC CHANNEL"/)
  assert.match(src, /platform\.id === "reddit"\) return "MANUAL ONLY"/)
  assert.match(src, /return "ASSISTED PUBLISHING"/)
  assert.match(src, /return "FROZEN"/)
  assert.match(src, /Promote your paid content and direct followers to OnlyFans or Fanvue\./)
  assert.match(src, /Native Reddit posting and scheduling are not configured\. Use caption copy\/export and Open Reddit to complete posting manually\./)
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

test("Reddit launch handoff is visibly manual-only without changing non-Reddit labels", () => {
  const src = generate()
  assert.match(src, /<SelectItem value="reddit">Reddit \(manual only\)<\/SelectItem>/)
  assert.match(src, /autopostPlatform === "reddit" \? "Manual Reddit Handoff" : "Autopost Handoff"/)
  assert.match(src, /autopostPlatform === "reddit" \? "Prepare Manual Reddit Draft" : "Prepare Autopost Draft"/)
  assert.match(src, /autopostPlatform === "reddit" \? "Open Manual Posting Tools" : "Send to Autopost Builder"/)
  assert.match(src, /Native Reddit posting and scheduling are not configured\. Copy or export the prepared caption, open Reddit, and complete the post manually\./)
  assert.match(src, /Copy All Captions/)
  assert.match(src, /Export \.TXT/)
  for (const label of ["Fanvue", "OnlyFans", "Fansly", "ManyVids", "X"]) {
    assert.match(src, new RegExp(`>${label}<\\/SelectItem>`))
  }

  const autopost = client()
  assert.match(autopost, /if \(platform\.id === "reddit"\) return "MANUAL ONLY"/)
  assert.match(autopost, /Native Reddit posting and scheduling are not configured\. Use caption copy\/export and Open Reddit to complete posting manually\./)
  assert.match(autopost, /if \(platform\.id === "reddit"\) return "Open Reddit"/)
  assert.match(autopost, /disabled=\{!selectable\}/)
  assert.match(autopost, /const selectable = isPlatformSelectable\(p\)/)
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


test("creator publishing workflow is stacked above the Autopost cursor background", () => {
  const client = readFileSync("app/autopost/AutopostPageClient.tsx", "utf8")
  const workflow = orchestration()
  const serverPage = page()

  assert.match(client, /fixed inset-0 z-0/)
  assert.match(client, /radial-gradient\(600px circle at \$\{mousePosition\.x\}px \$\{mousePosition\.y\}px/)
  assert.match(client, /<main className="relative z-10/)
  assert.match(workflow, /<section className="relative z-10 mx-auto mt-8 max-w-6xl/)
  assert.match(serverPage, /<section className="relative z-10 mx-auto mt-8 max-w-6xl rounded-3xl/)
  assert.match(workflow, /fetch\("\/api\/creator-publishing-queue\/autopost\/plans"/)
  assert.match(workflow, /body:JSON\.stringify\(\{contentPackageIds:selected,idempotencyKey:key\}\)/)
})
