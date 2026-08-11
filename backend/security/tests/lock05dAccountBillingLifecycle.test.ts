import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveCollectedBillingCustomerIds } from "../../../lib/stripe/billingCustomerResolver";

const baseline = "a7c5a8d2e40f9df5acdfaa3867bb59fe628af3b3";
const read = (path: string) => readFileSync(path, "utf8");
const accountAccess = read("lib/account-access.ts");
const accountPage = read("app/account/page.tsx");
const billingPage = read("app/billing/page.tsx");
const resolver = read("lib/stripe/billingCustomerResolver.ts");
const portal = read("app/api/billing/portal/route.ts");
const guard = read("lib/subscription-checker.ts");

function hasActivePlan(statuses: string[]) {
  return statuses.find((status) => ["active", "trialing"].includes(status.trim().toLowerCase())) !== undefined;
}

test("Payment V2 source remains frozen from the required baseline", () => {
  const protectedPaths = [
    "app/api/checkout/subscription-v2/route.ts", "lib/payment-v2/checkoutService.ts",
    "app/api/webhook/payment-v2/route.ts", "app/api/payment-v2", "lib/payment-v2",
    "backend/payment-v2", "backend/affiliate", "supabase/migrations",
  ];
  const changed = execFileSync("git", ["diff", "--name-only", baseline, "--", ...protectedPaths], { encoding: "utf8" });
  assert.equal(changed.trim(), "");
});

test("authenticated-profile access validates auth and looks up a profile without subscription gating", () => {
  assert.match(accountAccess, /supabaseServer\(\)/);
  assert.match(accountAccess, /auth\.getUser\(\)/);
  assert.match(accountAccess, /\.from\("profiles"\)[\s\S]*\.eq\("user_id", user\.id\)/);
  for (const code of ["UNAUTHENTICATED", "PROFILE_LOOKUP_FAILED", "NO_PROFILE", "INTERNAL_ERROR"]) assert.match(accountAccess, new RegExp(code));
  assert.doesNotMatch(accountAccess, /user_subscriptions|active|trialing|cookies\s*\(/);
  assert.match(accountAccess, /id, user_id, email, badge, seat_number, stripe_customer_id/);
});

test("account and billing pages use profile access and remain lifecycle-safe", () => {
  for (const source of [accountPage, billingPage]) {
    assert.match(source, /ensureAuthenticatedProfile\(\)/);
    assert.doesNotMatch(source, /ensureActiveSubscription/);
    assert.match(source, /activeSubscription !== null/);
    assert.match(source, /activeSubscription \?\? latestSubscription/);
  }
  assert.match(accountPage, /redirect\("\/login"\)/);
  assert.doesNotMatch(accountPage, /redirect\("\/pricing"\)/);
  assert.match(billingPage, /redirect\("\/login"\)/);
  assert.doesNotMatch(billingPage, /redirect\("\/pricing"\)/);
});

test("hasActivePlan is true only for normalized active or trialing", () => {
  assert.equal(hasActivePlan(["active"]), true);
  assert.equal(hasActivePlan([" TRIALING "]), true);
  for (const status of ["canceled", "past_due", "inactive", "unpaid", "incomplete", "incomplete_expired", "paused"]) assert.equal(hasActivePlan([status]), false, status);
  assert.equal(hasActivePlan([]), false);
});

test("customer IDs resolve by set cardinality without source precedence", () => {
  assert.deepEqual(resolveCollectedBillingCustomerIds(["cus_profile"]), { ok: true, customerId: "cus_profile" });
  assert.deepEqual(resolveCollectedBillingCustomerIds([undefined, "cus_subscription"]), { ok: true, customerId: "cus_subscription" });
  assert.deepEqual(resolveCollectedBillingCustomerIds([undefined, undefined, "cus_purchase"]), { ok: true, customerId: "cus_purchase" });
  assert.deepEqual(resolveCollectedBillingCustomerIds(["cus_same", " cus_same ", "cus_same"]), { ok: true, customerId: "cus_same" });
  assert.deepEqual(resolveCollectedBillingCustomerIds([null, "", "   "]), { ok: false, code: "BILLING_CUSTOMER_NOT_FOUND" });
  assert.deepEqual(resolveCollectedBillingCustomerIds(["cus_a", "cus_b"]), { ok: false, code: "BILLING_CUSTOMER_AMBIGUOUS" });
  assert.deepEqual(resolveCollectedBillingCustomerIds(["cus_b", "cus_a"]), { ok: false, code: "BILLING_CUSTOMER_AMBIGUOUS" });
});

test("billing customer resolver reads only the three authoritative profile-linked sources", () => {
  assert.match(resolver, /\.from\("profiles"\)[\s\S]*\.eq\("id", profileId\)/);
  assert.match(resolver, /\.from\("user_subscriptions"\)[\s\S]*\.eq\("user_id", profileId\)/);
  assert.match(resolver, /\.from\("payment_v2_purchases"\)[\s\S]*\.eq\("claimed_profile_id", profileId\)/);
  assert.doesNotMatch(resolver, /\.(insert|update|delete|upsert|rpc)\s*\(/);
  assert.doesNotMatch(resolver, /payment_v2_(holds|allocations)|customers\.(list|search|create)|email|metadata/);
});

test("portal creates only a portal session and never imports customer creation", () => {
  assert.match(portal, /ensureAuthenticatedProfile\(\)/);
  assert.match(portal, /resolveExistingBillingCustomer\(profileId\)/);
  assert.doesNotMatch(portal, /getOrCreateStripeCustomer|stripe\.customers\.(create|update)|stripe\.subscriptions\.(create|update|cancel)|stripe\.checkout\.sessions\.create/);
  assert.equal((portal.match(/stripe\.[\w.]+\.create/g) ?? []).join(","), "stripe.billingPortal.sessions.create");
});

test("paid creator and generator surfaces retain the unchanged active-subscription guard", () => {
  const guardDiff = execFileSync("git", ["diff", "--name-only", baseline, "--", "lib/subscription-checker.ts"], { encoding: "utf8" });
  assert.equal(guardDiff.trim(), "");
  assert.match(guard, /\.in\("status", \["active", "trialing"\]\)/);
  assert.match(guard, /subscription\.status === "active" \|\| subscription\.status === "trialing"/);
  assert.match(guard, /UNAUTHENTICATED/);
  assert.match(guard, /NO_ACTIVE_SUBSCRIPTION/);
  for (const path of ["app/generate/layout.tsx", "app/api/generate/route.ts", "app/sirens-mind/layout.tsx", "app/lora/train/page.tsx"]) {
    assert.match(read(path), /ensureActiveSubscription\(\)/, path);
  }
});
