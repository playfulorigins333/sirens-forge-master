import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const loaderPath = "lib/creator-publishing-queue/verification/loaders.ts"
const reviewPagePath = "app/creator/publishing-queue/review/verifications/page.tsx"
const migrationPath = "supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql"

const loader = fs.readFileSync(loaderPath, "utf8")
const reviewPage = fs.readFileSync(reviewPagePath, "utf8")
const migration = fs.readFileSync(migrationPath, "utf8")

test("Fanvue creators participate in creator identity discovery", () => {
  assert.match(loader, /CREATOR_IDENTITY_DISCOVERY_PLATFORMS\s*=\s*\["onlyfans",\s*"fansly",\s*"fanvue"\]/)
  assert.match(loader, /\.in\("target_platform",\s*\[\.\.\.CREATOR_IDENTITY_DISCOVERY_PLATFORMS\]\)/)
  assert.match(loader, /\.in\("platform",\s*\[\.\.\.CREATOR_IDENTITY_DISCOVERY_PLATFORMS\]\)/)
})

test("Fanvue platform-account verification remains excluded", () => {
  assert.match(loader, /PLATFORM_ACCOUNT_REVIEW_PLATFORMS\s*=\s*\["onlyfans",\s*"fansly"\]/)
  assert.match(loader, /accountSubjectDisplayQuery[\s\S]*\.in\("platform",\s*\[\.\.\.PLATFORM_ACCOUNT_REVIEW_PLATFORMS\]\)/)
  assert.doesNotMatch(loader, /PLATFORM_ACCOUNT_REVIEW_PLATFORMS[^\n]*fanvue/)
  assert.match(migration, /v_account\.platform = 'fanvue'[\s\S]*VERIFICATION_FANVUE_NOT_SUPPORTED/)
  assert.match(migration, /v_account\.platform not in \('onlyfans','fansly'\)/)
})

test("review copy distinguishes creator identity from platform-account review", () => {
  assert.match(reviewPage, /Fanvue creators can appear for creator identity review/i)
  assert.match(reviewPage, /Fanvue platform-account verification remains excluded/i)
})
