import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const loaderPath = "lib/creator-publishing-queue/verification/loaders.ts"
const reviewPagePath = "app/creator/publishing-queue/review/verifications/page.tsx"
const verificationMigrationPath = "supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql"
const bootstrapMigrationPath = "supabase/migrations/20260817221000_cpq_trusted_reviewer_bootstrap.sql"

const loader = fs.readFileSync(loaderPath, "utf8")
const reviewPage = fs.readFileSync(reviewPagePath, "utf8")
const verificationMigration = fs.readFileSync(verificationMigrationPath, "utf8")
const bootstrapMigration = fs.readFileSync(bootstrapMigrationPath, "utf8")

test("Fanvue creators participate in creator identity discovery", () => {
  assert.match(loader, /CREATOR_IDENTITY_DISCOVERY_PLATFORMS\s*=\s*\["onlyfans",\s*"fansly",\s*"fanvue"\]/)
  assert.match(loader, /\.in\("target_platform",\s*\[\.\.\.CREATOR_IDENTITY_DISCOVERY_PLATFORMS\]\)/)
  assert.match(loader, /\.in\("platform",\s*\[\.\.\.CREATOR_IDENTITY_DISCOVERY_PLATFORMS\]\)/)
})

test("Fanvue platform-account verification remains excluded", () => {
  assert.match(loader, /PLATFORM_ACCOUNT_REVIEW_PLATFORMS\s*=\s*\["onlyfans",\s*"fansly"\]/)
  assert.match(loader, /accountSubjectDisplayQuery[\s\S]*\.in\("platform",\s*\[\.\.\.PLATFORM_ACCOUNT_REVIEW_PLATFORMS\]\)/)
  assert.doesNotMatch(loader, /PLATFORM_ACCOUNT_REVIEW_PLATFORMS[^\n]*fanvue/)
  assert.match(verificationMigration, /v_account\.platform = 'fanvue'[\s\S]*VERIFICATION_FANVUE_NOT_SUPPORTED/)
  assert.match(verificationMigration, /v_account\.platform not in \('onlyfans','fansly'\)/)
})

test("review copy distinguishes creator identity from platform-account review", () => {
  assert.match(reviewPage, /Fanvue creators can appear for creator identity review/i)
  assert.match(reviewPage, /Fanvue platform-account verification remains excluded/i)
})

test("first trusted reviewer bootstrap is fail-closed and service-role-only", () => {
  assert.match(bootstrapMigration, /creator_publishing_bootstrap_first_trusted_reviewer/)
  assert.match(bootstrapMigration, /p_actor_id\s*=\s*p_reviewer_id[\s\S]*TRUSTED_REVIEWER_BOOTSTRAP_SELF_REVIEWER_FORBIDDEN/)
  assert.match(bootstrapMigration, /select count\(\*\) into v_existing_count[\s\S]*TRUSTED_REVIEWER_BOOTSTRAP_ALREADY_INITIALIZED/)
  assert.match(bootstrapMigration, /not exists \(select 1 from auth\.users where id = p_actor_id\)/)
  assert.match(bootstrapMigration, /not exists \(select 1 from auth\.users where id = p_reviewer_id\)/)
  assert.match(bootstrapMigration, /pg_advisory_xact_lock/)
  assert.match(bootstrapMigration, /insert into public\.creator_publishing_trusted_reviewers/)
  assert.match(bootstrapMigration, /'reviewer'/)
  assert.match(bootstrapMigration, /trusted_reviewer_bootstrapped/)
  assert.match(bootstrapMigration, /revoke all on function public\.creator_publishing_bootstrap_first_trusted_reviewer\(uuid, uuid, text\) from PUBLIC/i)
  assert.match(bootstrapMigration, /from anon/i)
  assert.match(bootstrapMigration, /from authenticated/i)
  assert.match(bootstrapMigration, /grant execute on function public\.creator_publishing_bootstrap_first_trusted_reviewer\(uuid, uuid, text\) to service_role/i)
  assert.doesNotMatch(bootstrapMigration, /creator_publishing_creator_verifications\s*\(/)
  assert.doesNotMatch(bootstrapMigration, /creator_publishing_ai_twin_consents\s*\(/)
  assert.doesNotMatch(bootstrapMigration, /creator_publishing_platform_jobs\s*\(/)
})
