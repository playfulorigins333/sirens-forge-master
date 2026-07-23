import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const baseSha = "ea488661edbe369ac3af36d2f72e53a818b3581a"

function read(path: string) {
  return readFileSync(path, "utf8")
}

function git(args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" })
}

function assertIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message)
}

const autopostClientPath = "app/autopost/AutopostPageClient.tsx"
const autopostPagePath = "app/autopost/page.tsx"
const rulesRoutePath = "app/api/autopost/rules/route.ts"
const approveRoutePath = "app/api/autopost/rules/[rule_id]/approve/route.ts"
const platformAvailabilityPath = "lib/autopost/platformAvailability.ts"
const platformRegistryPath = "lib/autopost/platformRegistry.ts"

const autopostClient = read(autopostClientPath)
const autopostPage = read(autopostPagePath)
const rulesRoute = read(rulesRoutePath)
const approveRoute = read(approveRoutePath)
const platformAvailability = read(platformAvailabilityPath)
const platformRegistry = read(platformRegistryPath)

assertIncludes(autopostClient, "last_run_at?: string | null", "AutopostRule must use the database last_run_at field")
assert.ok(!autopostClient.includes("last_ran_at"), "active UI source must not reference last_ran_at")
assertIncludes(autopostClient, "formatTs(rule.last_run_at)", "Last Run display must read rule.last_run_at")

assertIncludes(autopostClient, "function isXOnlyRule(rule: AutopostRule)", "isXOnlyRule helper must exist")
assertIncludes(autopostClient, "const platforms = rulePlatformIds(rule).map(platform => String(platform).toLowerCase())", "isXOnlyRule must use normalized rulePlatformIds values")
assertIncludes(autopostClient, "return platforms.length === 1 && platforms[0] === \"x\"", "isXOnlyRule must require exactly one x platform")
assertIncludes(autopostClient, "function isXOnlyDraft(rule: AutopostRule)", "isXOnlyDraft helper must exist")
assertIncludes(autopostClient, "return isXOnlyRule(rule) && String(rule.approval_state).toUpperCase() === \"DRAFT\"", "isXOnlyDraft must require X-only classification and DRAFT state")

assertIncludes(autopostClient, "const fanvueInternalValidationDraft = isFanvueInternalValidationDraft(rule)", "actionsFor must continue identifying Fanvue internal-validation drafts")
assertIncludes(autopostClient, "const xOnlyDraft = isXOnlyDraft(rule)", "actionsFor must identify X-only drafts")
assertIncludes(autopostClient, "canApprove: state === \"DRAFT\" && !fanvueInternalValidationDraft && !xOnlyDraft", "canApprove must be limited to DRAFT rules excluding Fanvue internal-validation drafts and X-only drafts")
assertIncludes(autopostClient, "canPause: state === \"APPROVED\"", "pause behavior must remain limited to APPROVED")
assertIncludes(autopostClient, "canResume: state === \"PAUSED\"", "resume behavior must remain limited to PAUSED")
assertIncludes(autopostClient, "canRevoke: state !== \"REVOKED\"", "revoke behavior must remain available until REVOKED")
assertIncludes(autopostClient, "{a.canApprove && (", "Approve button must remain guarded by a.canApprove")
assertIncludes(autopostClient, "onClick={() => openApprove(rule)}", "Approve button must remain the only card path that opens approval")

assertIncludes(autopostClient, "const saveXDraftRule = async () =>", "saveXDraftRule must remain present")
assertIncludes(autopostClient, "selected_platforms: [\"x\"]", "X draft request must keep selected_platforms: [\"x\"]")
assertIncludes(autopostClient, "Save X Draft", "Save X Draft action must remain present")
assertIncludes(autopostClient, "X draft saved. Scheduled posting is still disabled until final posting checks are complete.", "X draft success message must remain present")
assertIncludes(autopostClient, "Nothing has been sent to X or scheduled.", "saved-draft truth must remain present")
assertIncludes(autopostClient, "My Rules", "My Rules collection must remain present")
assertIncludes(autopostClient, "{rules.map(rule => {", "rules UI must continue rendering saved rules")
assertIncludes(autopostClient, "const xOnlyDraft = isXOnlyDraft(rule)", "X-only DRAFT status treatment must be derived inside the saved-rule card path")
assertIncludes(autopostClient, "X draft only", "X-only DRAFT status must say X draft only")
assertIncludes(autopostClient, "Approval unavailable", "X-only DRAFT status must say approval is unavailable")
assertIncludes(autopostClient, "Scheduled posting disabled", "X-only DRAFT status must say scheduled posting is disabled")
assertIncludes(autopostClient, "This X draft remains saved and visible in My Rules. Approval is unavailable and scheduled posting is disabled. Nothing has been posted, scheduled, or sent to X.", "X-only DRAFT status must state saved visibility and no post/schedule/send occurred")
assertIncludes(autopostClient, "label: \"X DRAFT ONLY\"", "X-only DRAFT must use a narrow card state label override")
assert.ok(!autopostClient.includes("xOnlyDraft\n                            ? { ...baseBadge, label: \"NEEDS APPROVAL\" }"), "X-only DRAFT must not display the generic NEEDS APPROVAL state label")

assertIncludes(rulesRoute, ".select(\"*\")", "rules GET route must still select all database fields")
for (const needle of ["enabled: false", "approval_state: \"DRAFT\"", "next_run_at: null", "last_run_at: null"]) {
  assertIncludes(rulesRoute, needle, `insert contract must contain ${needle}`)
}
assert.ok(existsSync(approveRoutePath), "actual approve route must remain under [rule_id]")
assert.ok(!existsSync("app/api/autopost/rules/[id]/approve/route.ts"), "incorrect [id] approve route must not exist")
assertIncludes(approveRoute, "filterSelectableAutopostPlatformIds(knownPlatforms)", "approve route must still filter through selectable platform IDs")
assertIncludes(platformRegistry, "public_selectable: false", "X must remain public_selectable false in registry")
assertIncludes(platformAvailability, "can_schedule: false", "X must remain can_schedule false")
assertIncludes(platformAvailability, "supports_real_posting: false", "X must remain supports_real_posting false")
assertIncludes(platformAvailability, "public_selectable: false", "X availability must preserve public_selectable false")

assertIncludes(autopostPage, "<AutopostPageClient />", "autopost page must still mount AutopostPageClient")
assertIncludes(autopostClient, "AUTOPOST_PACK_PREFILL_STORAGE_KEY", "Generate handoff support must remain present")
assertIncludes(autopostClient, "setXDraftText(bestDraftText)", "Generate handoff must still prepare X draft text")
assertIncludes(autopostClient, "connectX", "X connection UI support must remain present")
assertIncludes(autopostClient, "disconnectX", "X disconnection UI support must remain present")

const changed = new Set([
  ...git(["diff", "--name-only", baseSha]).split(/\r?\n/),
  ...git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/),
].map(path => path.trim()).filter(Boolean))
assert.deepEqual([...changed].sort(), [
  "app/autopost/AutopostPageClient.tsx",
  "backend/autopost/tests/xDraftUiTruth.test.ts",
], "changed path set must be exactly the two authorized files")

console.log("X draft UI truth source-contract tests passed; source-contract evidence only, not browser-runtime, provider, OAuth, Production, or live-post proof.")
