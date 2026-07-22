import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"

const pagePath = "app/autopost/page.tsx"
const vercelPath = "vercel.json"
const dormantFiles = [
  "app/autopost/AutopostPageClient.tsx",
  "app/autopost/Task14AutopostOrchestration.tsx",
  "app/autopost/Task15PlanScheduling.tsx",
]
const dormantRoutePath = "app/api/autopost/run/route.ts"

function readPage() {
  assert.equal(existsSync(pagePath), true, "app/autopost/page.tsx must exist")
  return readFileSync(pagePath, "utf8")
}

test("public AutoPost page preserves protected authentication and subscription boundary", () => {
  const page = readPage()

  assert.match(page, /import \{ ensureActiveSubscription \} from "@\/lib\/subscription-checker"/)
  assert.match(page, /const auth = await ensureActiveSubscription\(\)/)
  assert.match(page, /auth\.error === "UNAUTHENTICATED"[\s\S]*redirect\("\/login"\)/)
  assert.match(page, /redirect\("\/pricing"\)/)
  assert.doesNotMatch(page, /redirect\("\/dashboard"\)/)
  assert.doesNotMatch(page, /redirect\("\/autopost[^"]*"\)/)
})

test("public AutoPost page renders exact unavailable customer copy", () => {
  const page = readPage()

  assert.match(page, />AutoPost</)
  assert.match(page, />AutoPost is currently unavailable</)
  assert.match(page, /Publishing automation and scheduling are not available for customer use right now\. Your existing records remain preserved\./)
  assert.match(page, /No publishing, scheduling, or external-platform action can be started from this page\./)
})

test("public AutoPost page exposes exactly one dashboard navigation link", () => {
  const page = readPage()
  const hrefs = [...page.matchAll(/href=\{?"([^"]+)"\}?/g)].map((match) => match[1])

  assert.deepEqual(hrefs, ["/dashboard"])
  assert.match(page, />\s*Return to dashboard\s*</)
})

test("public AutoPost page does not mount dormant components or loaders", () => {
  const page = readPage()
  const forbiddenReferences = [
    "AutopostPageClient",
    "Task14AutopostOrchestration",
    "Task15PlanScheduling",
    "loadAutopostCapabilities",
    "loadAutopostPackageOptions",
    "loadCreatorPublishingSchedulingView",
    "randomUUID",
    "Task14AutopostLoadResult",
    "loadTask14AutopostSection",
  ]

  for (const reference of forbiddenReferences) {
    assert.equal(page.includes(reference), false, `${reference} must not be referenced by public AutoPost page`)
  }

  assert.doesNotMatch(page, /\b(capabilities|packages|schedulingView|publishingPlan|mutation|queue|operator|platformAccount|platform-account)\b/i)
})

test("public AutoPost page has no customer action controls", () => {
  const page = readPage()

  assert.doesNotMatch(page, /<\s*(form|button|input|select|textarea)\b/i)
  assert.doesNotMatch(page, /\b(action|formAction|onSubmit)=/)
  assert.doesNotMatch(page, /\btype=\{?"submit"\}?/i)
  assert.doesNotMatch(page, /\b(onClick|onChange|onInput)=/)
  assert.doesNotMatch(page, /href=\{?"[^"]*(queue|operator|platform-account|package|publish|schedule|cancel|external-platform)[^"]*"\}?/i)
})

test("public AutoPost page exposes no prohibited internal terminology", () => {
  const page = readPage()
  const forbiddenTerms = [
    /dormant infrastructure/i,
    /Task\s*(14|15|21|22)/i,
    /\bgate\b/i,
    /\bphase\b/i,
    /operator queue/i,
    /scheduler runner/i,
    /\bmigration\b/i,
    /\bRPC\b/i,
    /internal queue/i,
    /relation name/i,
    /SQLSTATE/i,
    /service-role/i,
    /canary/i,
    /implementation-state/i,
    /database/i,
  ]

  for (const term of forbiddenTerms) {
    assert.doesNotMatch(page, term)
  }
})

test("dormant AutoPost implementation files and route remain present but unmounted", () => {
  const page = readPage()

  for (const file of dormantFiles) {
    assert.equal(existsSync(file), true, `${file} must remain present`)
  }
  assert.equal(existsSync(dormantRoutePath), true, `${dormantRoutePath} must remain present`)
  assert.doesNotMatch(page, /\.\/AutopostPageClient|\.\/Task14AutopostOrchestration|\.\/Task15PlanScheduling/)
})

test("vercel config remains version-only and registers no crons", () => {
  assert.equal(existsSync(vercelPath), true, "vercel.json must remain present")
  const config = JSON.parse(readFileSync(vercelPath, "utf8")) as { version?: unknown; crons?: unknown }

  assert.equal(config.version, 2)
  assert.equal(config.crons, undefined)
  assert.deepEqual(Object.keys(config).sort(), ["version"])
})
