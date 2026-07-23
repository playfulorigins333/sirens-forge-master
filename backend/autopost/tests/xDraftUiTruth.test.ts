import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { register } from "node:module"

function read(path: string) {
  return readFileSync(path, "utf8")
}


function assertIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message)
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string, messagePrefix: string) {
  const start = source.indexOf(startNeedle)
  assert.notEqual(start, -1, `${messagePrefix} start must exist`)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  assert.notEqual(end, -1, `${messagePrefix} end must exist`)
  return source.slice(start, end)
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
const xOnlyBadgeAssignment = sliceBetween(
  autopostClient,
  "const badge = xOnlyDraft",
  "const BadgeIcon = badge.icon",
  "X-only per-card badge assignment"
)
assertIncludes(xOnlyBadgeAssignment, "const badge = xOnlyDraft", "X-only DRAFT badge assignment must be scoped to xOnlyDraft")
assertIncludes(xOnlyBadgeAssignment, "? { ...baseBadge, label: \"X DRAFT ONLY\" }", "X-only DRAFT must assign the X DRAFT ONLY label")
assertIncludes(xOnlyBadgeAssignment, ": baseBadge", "non-X-only rules must keep the base badge assignment")
assert.ok(!xOnlyBadgeAssignment.includes("NEEDS APPROVAL"), "X-only DRAFT badge assignment must not assign NEEDS APPROVAL")

assertIncludes(rulesRoute, ".select(\"*\")", "rules GET route must still select all database fields")
for (const needle of ["enabled: false", "approval_state: \"DRAFT\"", "next_run_at: null", "last_run_at: null"]) {
  assertIncludes(rulesRoute, needle, `insert contract must contain ${needle}`)
}
assert.ok(existsSync(approveRoutePath), "actual approve route must remain under [rule_id]")
assert.ok(!existsSync("app/api/autopost/rules/[id]/approve/route.ts"), "incorrect [id] approve route must not exist")
assertIncludes(approveRoute, "filterSelectableAutopostPlatformIds(knownPlatforms)", "approve route must still filter through selectable platform IDs")
const xAvailabilityBlock = sliceBetween(
  platformAvailability,
  'if (platform.id === "x") {',
  "\n  return {",
  "X platform availability branch"
)
for (const needle of [
  "public_selectable: false",
  "can_schedule: false",
  "supports_real_posting: platform.supports_real_posting",
  "supports_text_posting: true",
  "supports_media_posting: false",
  "supports_async_dispatch: platform.supports_async_dispatch",
]) {
  assertIncludes(xAvailabilityBlock, needle, `X platform availability branch must contain ${needle}`)
}

const xRegistrySeed = sliceBetween(
  platformRegistry,
  'id: "x",',
  'id: "reddit",',
  "X platform registry seed"
)
assertIncludes(xRegistrySeed, 'name: "X (Twitter)"', "X registry seed must exist")

const registryProjectionBlock = sliceBetween(
  platformRegistry,
  "export function getAutopostPlatformRegistry(): AutopostPlatformRegistryEntry[] {",
  "export function getPublicAutopostPlatforms()",
  "registry projection"
)
for (const needle of [
  "platform.public_selectable ?? false",
  "platform.supports_real_posting ?? false",
  "platform.supports_async_dispatch ?? false",
]) {
  assertIncludes(registryProjectionBlock, needle, `registry projection must preserve fail-closed defaults with ${needle}`)
}
assertIncludes(xRegistrySeed, 'launch_status: "coming_soon"', "X registry seed must remain coming soon")
assertIncludes(xRegistrySeed, "supports_real_posting: true", "X registry seed must report implemented native text posting")
assertIncludes(xRegistrySeed, "supports_async_dispatch: true", "X registry seed must report implemented internal async dispatch")
assert.ok(!xRegistrySeed.includes("AUTOPOST_WEBHOOK_X"), "X registry seed must not depend on obsolete AUTOPOST_WEBHOOK_X")

assertIncludes(autopostPage, "<AutopostPageClient />", "autopost page must still mount AutopostPageClient")
assertIncludes(autopostClient, "AUTOPOST_PACK_PREFILL_STORAGE_KEY", "Generate handoff support must remain present")
assertIncludes(autopostClient, "setXDraftText(bestDraftText)", "Generate handoff must still prepare X draft text")
assertIncludes(autopostClient, "connectX", "X connection UI support must remain present")
assertIncludes(autopostClient, "disconnectX", "X disconnection UI support must remain present")


const loaderSource = `export async function resolve(specifier, context, nextResolve) { if (specifier === 'server-only') return { url: 'data:text/javascript,export%20{}', shortCircuit: true }; return nextResolve(specifier, context) }`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const ENV_KEYS = [
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "X_REDIRECT_URI",
  "AUTOPOST_TOKEN_ENCRYPTION_KEY",
  "AUTOPOST_OAUTH_STATE_SECRET",
  "AUTOPOST_WEBHOOK_X",
] as const
const originalEnv = new Map<(typeof ENV_KEYS)[number], string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]))

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function clearXEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

function setFakeXOAuthEnv() {
  process.env.X_CLIENT_ID = "local-x-client"
  process.env.X_CLIENT_SECRET = "local-x-secret"
  process.env.X_REDIRECT_URI = "http://127.0.0.1:3000/api/autopost/connect/x/callback"
  process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  process.env.AUTOPOST_OAUTH_STATE_SECRET = "local-fake-state-secret"
}

function assertFakeXOAuthEnvironmentContract() {
  const redirectUri = process.env.X_REDIRECT_URI
  assert.ok(redirectUri, "fake X redirect URI must be configured")

  const parsedRedirectUri = new URL(redirectUri)
  assert.equal(
    parsedRedirectUri.pathname,
    "/api/autopost/connect/x/callback",
    "fake X redirect URI must use the actual callback pathname"
  )
  assert.equal(parsedRedirectUri.search, "", "fake X redirect URI must not contain a query string")
  assert.equal(parsedRedirectUri.hash, "", "fake X redirect URI must not contain a fragment")

  const envExample = read(".env.example")
  assertIncludes(
    envExample,
    "X_REDIRECT_URI=https://example.com/api/autopost/connect/x/callback",
    ".env.example must document the actual X callback pathname"
  )

  assert.equal(
    existsSync("app/api/autopost/connect/x/callback/route.ts"),
    true,
    "actual X callback route must exist"
  )
  assert.equal(
    existsSync("app/api/autopost/x/callback/route.ts"),
    false,
    "obsolete X callback route must not exist"
  )

  const encodedKey = process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY
  assert.ok(encodedKey, "fake token-encryption key must be configured")

  const decodedKey = Buffer.from(encodedKey, "base64")
  assert.equal(decodedKey.length, 32, "fake token-encryption key must decode to exactly 32 bytes")
  assert.equal(
    decodedKey.toString("base64"),
    encodedKey,
    "fake token-encryption key must use canonical base64"
  )
}

function assertXCapability(status: any) {
  assert.equal(status.public_selectable, false)
  assert.equal(status.can_schedule, false)
  assert.equal(status.supports_real_posting, true)
  assert.equal(status.supports_text_posting, true)
  assert.equal(status.supports_media_posting, false)
  assert.equal(status.supports_async_dispatch, true)
}

try {
  const { getAutopostPlatformRegistry, getSelectableAutopostPlatformIds, getPublicAutopostPlatforms } = await import("../../../lib/autopost/platformRegistry")
  const { buildUserPlatformStatus } = await import("../../../lib/autopost/platformAvailability")

  clearXEnv()
  let registry = getAutopostPlatformRegistry()
  const x = registry.find((platform) => platform.id === "x")
  assert.ok(x, "X registry entry must exist")
  assert.equal(x.launch_status, "coming_soon")
  assert.equal(x.public_selectable, false)
  assert.equal(x.supports_real_posting, true)
  assert.equal(x.supports_async_dispatch, true)
  assert.equal(x.supports_assisted_workflow, true)
  assert.notEqual(x.env_var, "AUTOPOST_WEBHOOK_X")
  assert.match(`${x.reason} ${x.status_message}`, /Text-only .*implemented.*controlled validation/i)
  assert.match(`${x.reason} ${x.status_message}`, /media posting.*not supported|media posting.*incomplete/i)
  assert.doesNotMatch(`${x.reason} ${x.status_message}`, /no direct posting integration exists/i)
  assert.equal(getSelectableAutopostPlatformIds().has("x"), false)

  const withoutWebhook = {
    launch_status: x.launch_status,
    public_selectable: x.public_selectable,
    supports_real_posting: x.supports_real_posting,
    supports_async_dispatch: x.supports_async_dispatch,
  }
  process.env.AUTOPOST_WEBHOOK_X = "https://webhook.invalid/x"
  const xWithWebhook = getAutopostPlatformRegistry().find((platform) => platform.id === "x")
  assert.deepEqual({
    launch_status: xWithWebhook?.launch_status,
    public_selectable: xWithWebhook?.public_selectable,
    supports_real_posting: xWithWebhook?.supports_real_posting,
    supports_async_dispatch: xWithWebhook?.supports_async_dispatch,
  }, withoutWebhook)
  assert.equal(xWithWebhook?.launch_status, "coming_soon")

  clearXEnv()
  const incompleteStatus = buildUserPlatformStatus(x, new Map())
  assert.equal(incompleteStatus.launch_status, "not_configured")
  assert.equal(incompleteStatus.app_configured, false)
  assert.equal(incompleteStatus.oauth_configured, false)
  assert.equal(incompleteStatus.can_connect, false)
  assert.equal(incompleteStatus.config_error, "X_OAUTH_CONFIG_INCOMPLETE")
  assertXCapability(incompleteStatus)
  assert.doesNotMatch(`${incompleteStatus.status_message} ${incompleteStatus.disabled_reason}`, /no (native|direct) posting integration/i)

  setFakeXOAuthEnv()
  assertFakeXOAuthEnvironmentContract()
  const completeStatus = buildUserPlatformStatus(x, new Map())
  assert.equal(completeStatus.launch_status, "coming_soon")
  assert.equal(completeStatus.app_configured, true)
  assert.equal(completeStatus.oauth_configured, true)
  assert.equal(completeStatus.can_connect, true)
  assert.equal(completeStatus.config_error, null)
  assert.equal(completeStatus.user_connected, false)
  assertXCapability(completeStatus)

  const connectedStatus = buildUserPlatformStatus(x, new Map([["x", {
    platform: "x",
    provider_account_id: "local-provider-account",
    provider_username: "local-provider-user",
    connection_status: "CONNECTED",
    connected_at: "2026-07-23T00:00:00.000Z",
    last_refresh_at: "2026-07-23T00:10:00.000Z",
    last_error: null,
  }]]))
  assert.equal(connectedStatus.user_connected, true)
  assert.equal(connectedStatus.connection_status, "CONNECTED")
  assert.equal(connectedStatus.public_selectable, false)
  assert.equal(connectedStatus.can_schedule, false)
  const connectedMessage = `${connectedStatus.status_message} ${connectedStatus.disabled_reason}`
  assert.match(connectedMessage, /stored connection for controlled validation/i)
  assert.match(connectedMessage, /posture.*unverified|live posting.*unverified/i)
  assert.doesNotMatch(connectedMessage, /live-ready|ready for live posting|operationally ready|live posting enabled/i)

  const remainingBlockers = [
    "X_ENVIRONMENT_VERIFICATION_REQUIRED",
    "X_INITIAL_OAUTH_TOKEN_VALIDATION_REQUIRED",
    "X_WEIGHTED_TEXT_VALIDATION_REQUIRED",
    "X_OAUTH_PROOF_REQUIRED",
    "X_CONNECTED_ACCOUNT_POSTURE_REQUIRED",
    "X_PROVIDER_REVOCATION_REQUIRED",
    "X_LIVE_TEXT_POST_CANARY_REQUIRED",
    "X_PUBLIC_ENABLEMENT_NOT_APPROVED",
  ]
  for (const blocker of remainingBlockers) assert.ok(completeStatus.blockers.includes(blocker), `${blocker} must remain active`)
  for (const blocker of ["CONTENT_PERSISTENCE_NOT_READY", "X_POSTING_ADAPTER_NOT_READY", "RUN_RESULT_PERSISTENCE_NOT_READY"]) {
    assert.ok(!completeStatus.blockers.includes(blocker), `${blocker} must be removed from active X blockers`)
    assert.ok(!xAvailabilityBlock.includes(blocker), `${blocker} must not appear in active X availability source`)
  }

  const fanvue = registry.find((platform) => platform.id === "fanvue")
  const onlyfans = registry.find((platform) => platform.id === "onlyfans")
  const reddit = registry.find((platform) => platform.id === "reddit")
  assert.equal(fanvue?.env_var, "AUTOPOST_WEBHOOK_FANVUE")
  assert.equal(fanvue?.supports_real_posting, false)
  assert.equal(fanvue?.supports_async_dispatch, false)
  assert.match(fanvue?.reason ?? "", /frozen for safety/i)
  assert.equal(onlyfans?.supports_assisted_workflow, true)
  assert.equal(onlyfans?.supports_real_posting, false)
  assert.equal(reddit?.public_selectable, false)
  assert.deepEqual(getPublicAutopostPlatforms().map((platform) => platform.id), ["fanvue", "onlyfans", "x", "reddit"])
} finally {
  restoreEnv()
}


console.log("X draft UI truth source-contract and runtime capability tests passed; evidence only, not browser-runtime, provider, OAuth, Production, or live-post proof.")
