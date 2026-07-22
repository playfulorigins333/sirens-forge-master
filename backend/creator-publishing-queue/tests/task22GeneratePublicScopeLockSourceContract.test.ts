import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"

const pagePath = "app/generate/page.tsx"
const layoutPath = "app/generate/layout.tsx"
const preservedFiles = [
  "components/generate/BuildMyModelCard.tsx",
  "app/api/generate/route.ts",
  "app/api/generate_video/route.ts",
  "components/chat/ChatUI.tsx",
  "app/library/LibraryClient.tsx",
  "app/dashboard/page.tsx",
  "app/account/page.tsx",
  "app/lora/train/TrainPageClient.tsx",
  "app/identities/[id]/IdentityDetailClient.tsx",
  "app/identities/IdentitiesClient.tsx",
  "app/api/autopost/preview/route.ts",
  "supabase/migrations/20260710000600_creator_publishing_generated_media_association.sql",
]

function readPage() {
  assert.equal(existsSync(pagePath), true, "app/generate/page.tsx must exist")
  return readFileSync(pagePath, "utf8")
}

function readLayout() {
  assert.equal(existsSync(layoutPath), true, "app/generate/layout.tsx must exist")
  return readFileSync(layoutPath, "utf8")
}

test("Generate page renders exact unavailable customer copy", () => {
  const page = readPage()

  assert.match(page, />\s*Generate\s*</)
  assert.match(page, />\s*Generation is currently unavailable\s*</)
  assert.match(page, /Image and video generation are not available for customer use right\s+now\. Your existing generated media remains preserved\./)
  assert.match(page, /No generation request or AutoPost handoff can be started from this\s+page\./)
})

test("Generate page exposes exactly one library navigation link", () => {
  const page = readPage()
  const hrefs = [...page.matchAll(/href=\{?"([^"]+)"\}?/g)].map((match) => match[1])

  assert.deepEqual(hrefs, ["/library"])
  assert.match(page, />\s*View your library\s*</)
})

test("Generate page does not import, mount, call, or reference generation implementations", () => {
  const page = readPage()
  const forbiddenReferences = [
    "BuildMyModelCard",
    "GenerateButton",
    "createBrowserClient",
    "handleGenerate",
    "/api/generate",
    "/api/generate_video",
    "fetch(",
    "text_to_image",
    "image_to_image",
    "image_to_video",
    "text_to_video",
    "recommended refinement",
    "recommended-refine",
    "generation handoff",
    "sirensforge:siren_mind_handoff",
    "sirensforge:next_pack_seed",
  ]

  for (const reference of forbiddenReferences) {
    assert.equal(page.includes(reference), false, `${reference} must not be referenced by public Generate page`)
  }

  assert.doesNotMatch(page, /\bSupabase\b|supabase\./)
  assert.doesNotMatch(page, /\b(useState|useEffect|useMemo|useRef|useSearchParams|useRouter)\b/)
  assert.doesNotMatch(page, /\b(handle|submit|mutat|payload|requestBody|FormData|FileReader|upload|prompt|negativePrompt|output|result|queue|pending)\b/i)
  assert.doesNotMatch(page, /\b(regeneration|regenerate|generate more|generate-more|refine|mode selector|model selector|aspect-ratio|seed|strength|motion)\b/i)
  assert.doesNotMatch(page, /Generate-to-AutoPost handoff/i)
})

test("Generate page has no customer action controls", () => {
  const page = readPage()

  assert.doesNotMatch(page, /<\s*(form|button|input|textarea|select)\b/i)
  assert.doesNotMatch(page, /\b(action|formAction|onSubmit|onClick|onChange|onInput)=/)
  assert.doesNotMatch(page, /\btype=\{?"submit"\}?/i)
  assert.doesNotMatch(page, /href=\{?"[^"]*(generate|autopost|retry|status|dashboard|account|identit|lora|help|docs?)[^"]*"\}?/i)
  assert.doesNotMatch(page, /\b(prompt submission|image-generation|video-generation|Build My Model|output-regeneration|recommended-refine|generate-more|file upload|drag-and-drop)\b/i)
})

test("Generate page exposes no prohibited internal terminology", () => {
  const page = readPage()
  const forbiddenTerms = [
    /\bpods\b/i,
    /RunPod/i,
    /infrastructure/i,
    /\bworker\b/i,
    /\bendpoint\b/i,
    /\bAPI\b/,
    /environment variable/i,
    /\bmigration\b/i,
    /\bRPC\b/,
    /\bTask\b/,
    /\bPhase\b/i,
    /\bGate\b/i,
    /\bcanary\b/i,
    /internal generation service/i,
    /SQLSTATE/i,
    /service-role/i,
    /internal queue/i,
    /generation worker/i,
    /\b(active|processing|pending|queued)\b/i,
  ]

  for (const term of forbiddenTerms) {
    assert.doesNotMatch(page, term)
  }
})

test("Generate layout preserves authentication and active-subscription boundary", () => {
  const layout = readLayout()
  const page = readPage()

  assert.match(layout, /ensureActiveSubscription\(\)/)
  assert.match(layout, /redirect\("\/login"\)/)
  assert.match(layout, /redirect\("\/pricing"\)/)
  assert.doesNotMatch(page, /ensureActiveSubscription|redirect\("\/login"\)|redirect\("\/pricing"\)|subscription-checker/)
})

test("preserved generation and adjacent systems remain present but unmounted", () => {
  const page = readPage()

  for (const file of preservedFiles) {
    assert.equal(existsSync(file), true, `${file} must remain present`)
  }

  assert.doesNotMatch(page, /BuildMyModelCard|api\/generate|api\/generate_video|ChatUI|LibraryClient|IdentityDetailClient|IdentitiesClient|TrainPageClient|autopost\/preview/)
})
