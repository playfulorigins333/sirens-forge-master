import assert from "node:assert/strict";
import {
  authenticationDestination, checkoutAuthCallbackUrl, checkoutPricingUrl, MAX_REFERRAL_LENGTH,
  normalizeReferral, oauthCallbackDestination, parseCheckoutContinuation, serializeCheckoutContinuation,
  signupAuthOptions, signupDestination,
} from "../../../lib/auth/checkoutContinuation";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); assertions += 1; };

for (const tier of ["og_throne", "early_bird"] as const) {
  const encoded = serializeCheckoutContinuation({ tier, referral: " ab 12 " });
  const intent = parseCheckoutContinuation(encoded);
  equal(intent, { tier, referral: "AB12", next: "/pricing" });
  equal(checkoutPricingUrl(intent!), `/pricing?tier=${tier}&confirm=checkout&ref=AB12`);
  equal(authenticationDestination(intent), `/pricing?tier=${tier}&confirm=checkout&ref=AB12`); // email login + immediate signup
}
for (const tier of ["prime_access", "standard", "starter_hit", "unknown"]) equal(serializeCheckoutContinuation({ tier }), null);
equal(normalizeReferral(" a b-c_1 "), "AB-C_1");
equal(normalizeReferral("A".repeat(MAX_REFERRAL_LENGTH)), "A".repeat(MAX_REFERRAL_LENGTH));
equal(normalizeReferral("A".repeat(MAX_REFERRAL_LENGTH + 1)), null);

for (const value of [
  "tier=og_throne&next=/dashboard", "tier=og_throne&next=https://evil.test", "tier=og_throne&next=//evil.test",
  "tier=og_throne&next=\\evil", "tier=og_throne&next=/pricing%0a", "tier=og_throne&next=%2Fpricing",
  "tier=og_throne&next=%E0%A4%A", "tier=og_throne&next=/pricing#x", "tier=og_throne&next=/pricing&extra=x",
]) equal(parseCheckoutContinuation(value), null);

const serialized = serializeCheckoutContinuation({ tier: "early_bird", referral: " friend " })!;
const callback = checkoutAuthCallbackUrl("https://sirens.test", serialized);
equal(callback, "https://sirens.test/auth/callback?checkout_intent=tier%3Dearly_bird%26ref%3DFRIEND%26next%3D%2Fpricing");
equal(checkoutAuthCallbackUrl("https://sirens.test", "tier=og_throne&next=https://evil.test"), "https://sirens.test/auth/callback");
equal(signupAuthOptions("https://sirens.test", serialized), { emailRedirectTo: callback });
const intent = parseCheckoutContinuation(serialized);
equal(signupDestination(false, intent), null); // confirmation-required: message only, no redirect/checkout
equal(signupDestination(true, intent), "/pricing?tier=early_bird&confirm=checkout&ref=FRIEND");
equal(oauthCallbackDestination(serialized, true), "/pricing?tier=early_bird&confirm=checkout&ref=FRIEND"); // Google/Discord callback
equal(oauthCallbackDestination("tier=og_throne&next=https://evil.test", true), "/generate");
equal(oauthCallbackDestination(serialized, false), "/login?error=oauth_failed");
equal(authenticationDestination(null), "/dashboard");

// All auth decisions return navigation destinations only; none can represent an API POST.
for (const destination of [authenticationDestination(intent), oauthCallbackDestination(serialized, true), signupDestination(true, intent)!]) {
  equal(destination.startsWith("/pricing?"), true);
  equal(destination.includes("/api/checkout"), false);
}
console.log(`checkoutContinuation: ${assertions} assertions passed`);
