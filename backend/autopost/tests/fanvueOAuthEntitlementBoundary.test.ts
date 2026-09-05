import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const start = readFileSync("app/api/autopost/connect/fanvue/start/route.ts", "utf8")
const callback = readFileSync("app/api/autopost/connect/fanvue/callback/route.ts", "utf8")
const subscriptionChecker = readFileSync("lib/subscription-checker.ts", "utf8")
const disconnect = readFileSync("app/api/autopost/connect/fanvue/disconnect/route.ts", "utf8")
const platformStatus = readFileSync("app/api/autopost/platforms/me/route.ts", "utf8")
const availability = readFileSync("lib/autopost/platformAvailability.ts", "utf8")

function position(source: string, fragment: string) {
  const index = source.indexOf(fragment)
  assert.notEqual(index, -1, `Expected source fragment: ${fragment}`)
  return index
}

// This models only the existing server-side contract; routes must call that contract rather
// than accepting any browser-supplied subscription status.
const entitledStatuses = new Set(["active", "trialing"])
for (const status of ["canceled", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", null]) {
  assert.equal(entitledStatuses.has(status ?? ""), false, `${status ?? "no subscription"} must be rejected`)
}
assert.equal(entitledStatuses.has("active"), true)
assert.equal(entitledStatuses.has("trialing"), true)
assert.match(subscriptionChecker, /\.in\("status", \["active", "trialing", "past_due", "unpaid", "canceled"\]\)/)
assert.match(subscriptionChecker, /PAYMENT_DELINQUENT/)
assert.match(subscriptionChecker, /error: "UNAUTHENTICATED"[\s\S]*?status: 401/)
assert.match(subscriptionChecker, /error: "NO_ACTIVE_SUBSCRIPTION"[\s\S]*?status: 402/)

assert.match(start, /import \{ ensureActiveSubscription \} from "@\/lib\/subscription-checker"/)
assert.doesNotMatch(start, /requireUserId/)
const startEntitlement = position(start, "await ensureActiveSubscription()")
for (const sideEffect of ["getFanvueOAuthConfigStatus()", "createFanvueOAuthState(userId)", "buildFanvueAuthorizeUrl({", "NextResponse.redirect(authorizeUrl)", "setFanvueOAuthCookie(response"]) {
  assert.ok(startEntitlement < position(start, sideEffect), `Start entitlement must precede ${sideEffect}`)
}
assert.match(start, /\{ error: entitlement\.error \?\? "NO_ACTIVE_SUBSCRIPTION" \}/)
assert.match(start, /const userId = entitlement\.user\.id/)

assert.match(callback, /import \{ ensureActiveSubscription \} from "@\/lib\/subscription-checker"/)
const operationValidation = position(callback, "validateFanvueOAuthOperationState({")
const ordinaryGate = position(callback, "if (statePayload.operation === FANVUE_CONNECT_OPERATION) {\n      const entitlement = await ensureActiveSubscription()")
const tokenExchange = position(callback, "await exchangeCodeForTokens({")
assert.ok(operationValidation < ordinaryGate, "Callback must identify a valid signed operation before entitlement revalidation")
assert.ok(ordinaryGate < tokenExchange, "Ordinary callback entitlement must precede provider token exchange")
for (const protectedWork of ["await fetchFanvueIdentity({", "encryptAutopostToken(tokenResponse.access_token)", "getSupabaseAdmin()", '.from("autopost_accounts")', ".upsert("]) {
  assert.ok(ordinaryGate < position(callback, protectedWork), `Callback entitlement must precede ${protectedWork}`)
}
assert.match(callback, /entitlement\.user\?\.id !== userId/)
assert.match(callback, /fanvue_oauth_no_active_subscription/)
assert.match(callback, /redirectWithClearedCookie\(\{[\s\S]*fanvue_oauth_no_active_subscription/)
assert.match(callback, /statePayload\.operation === FANVUE_WRITE_CREATOR_RECONNECT_OPERATION/)
assert.doesNotMatch(
  callback.slice(ordinaryGate, tokenExchange),
  /FANVUE_WRITE_CREATOR_RECONNECT_OPERATION[\s\S]*ensureActiveSubscription/,
  "Privileged reconnect must not be replaced by the ordinary paid-entitlement contract",
)

assert.doesNotMatch(disconnect, /ensureActiveSubscription/)
assert.match(disconnect, /requireFreshTotpResponse/)
assert.match(disconnect, /disconnect_publishing_provider/)
assert.match(disconnect, /p_user_id: userId[\s\S]*?p_provider: "fanvue"/)
assert.doesNotMatch(disconnect, /encrypted_access_token|encrypted_refresh_token/)

assert.doesNotMatch(platformStatus, /ensureActiveSubscription/)
assert.match(platformStatus, /requireUserId/)
assert.match(platformStatus, /\.eq\("user_id", userId\)/)
const returnedStatus = platformStatus.match(/return NextResponse\.json\(\{\s*platforms:[\s\S]*?\n  \}\)/)?.[0] ?? ""
assert.ok(returnedStatus, "Expected the platforms/me response projection")
assert.doesNotMatch(returnedStatus, /encrypted_access_token|encrypted_refresh_token/)

for (const frozenFlag of [
  "public_selectable: false",
  "can_schedule: false",
  "supports_real_posting: false",
  "supports_text_posting: false",
  "supports_media_posting: false",
]) {
  assert.match(availability, new RegExp(frozenFlag))
}

console.log("Fanvue OAuth paid-entitlement boundary checks passed")
