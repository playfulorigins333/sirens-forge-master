import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const read = (path: string) => fs.readFileSync(path, "utf8")
const helper = read("lib/subscription-checker.ts")
const shared = read("lib/creator-publishing-queue/creatorEntitlement.ts")

test("creator entitlement reuses the active/trialing subscription contract", () => {
  assert.match(shared, /ensureActiveSubscription/)
  assert.match(shared, /auth\.user\.id/)
  assert.match(helper, /\.in\("status", \["active", "trialing"\]\)/)
  assert.match(helper, /subscription\.status === "active" \|\| subscription\.status === "trialing"/)
  for (const inactive of ["canceled", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired"]) {
    assert.doesNotMatch(helper, new RegExp(`hasActiveSubscription[\\s\\S]{0,160}${inactive}`))
  }
  assert.match(helper, /UNAUTHENTICATED/)
  assert.match(helper, /NO_ACTIVE_SUBSCRIPTION/)
})

test("creator pages, reads, and mutations use the paid boundary before admin access", () => {
  for (const path of [
    "lib/creator-publishing-queue/ui/loaders.ts",
    "lib/creator-publishing-queue/consent/loaders.ts",
    "lib/creator-publishing-queue/scheduling/loaders.ts",
  ]) {
    const source = read(path)
    assert.ok(source.indexOf("requireActiveCreatorPageIdentity") < source.indexOf("getSupabaseAdmin()"), path)
  }
  for (const path of [
    "lib/creator-publishing-queue/accounts/service.ts",
    "lib/creator-publishing-queue/composer/service.ts",
    "lib/creator-publishing-queue/consent/service.ts",
    "lib/creator-publishing-queue/compliance/submission/service.ts",
  ]) assert.match(read(path), /activeCreatorIdOrNull/)
  const approval = read("app/creator/publishing-queue/actions.ts")
  assert.ok(approval.indexOf("sessionUserId()") < approval.indexOf("schema.safeParse"))
  assert.ok(approval.indexOf("sessionUserId()") < approval.indexOf("getSupabaseAdmin()"))
})

test("private media routes gate before validation and privileged work", () => {
  const signed = read("app/api/creator-publishing-queue/media/[mediaAssetId]/signed-url/route.ts")
  assert.ok(signed.indexOf("ensureActiveSubscription()") < signed.lastIndexOf("parseCreatorPublishingMediaAccessMode"))
  assert.ok(signed.indexOf("ensureActiveSubscription()") < signed.lastIndexOf("createCreatorPublishingSignedMediaUrl"))
  const generatedRoute = read("app/api/creator-publishing-queue/media/generated-assets/route.ts")
  assert.ok(generatedRoute.indexOf("ensureActiveSubscription()") < generatedRoute.lastIndexOf("handleGeneratedAssetsPost"))
  const generated = read("lib/creator-publishing-queue/media/generatedMediaCore.ts")
  for (const operation of ["getSupabaseAdmin()", "defaultR2Get", ".storage.from", 'rpc("creator_publishing_attach_generated_media"']) {
    assert.ok(generated.indexOf("resolveCreatorIdentity") < generated.indexOf(operation), operation)
  }
  assert.match(generated, /\.eq\("creator_id",creatorId\)/)
  assert.match(read("lib/creator-publishing-queue/media/core.ts"), /authenticatedCreatorId/)
})

test("operator and scheduler authorization boundaries remain subscription-independent", () => {
  for (const path of [
    "lib/creator-publishing-queue/operator-queue/service.ts",
    "lib/creator-publishing-queue/operator-media/service.ts",
    "lib/creator-publishing-queue/operator-completion/service.ts",
    "lib/creator-publishing-queue/scheduler-runner/service.ts",
    "app/api/creator-publishing-queue/scheduler/run/route.ts",
  ]) assert.doesNotMatch(read(path), /ensureActiveSubscription|creatorEntitlement/, path)
})
