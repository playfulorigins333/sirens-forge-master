import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePublicPurchaseState, LOCKED_PAYMENT_V2_PRICES, paymentFirstPublicCutoverEnabled, type PublicReadinessDependencies } from "../../../lib/payment-v2/publicPurchaseReadiness";

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions++; };
const gates = ["PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED", "PAYMENT_FIRST_WEBHOOK_V2_ENABLED", "PAYMENT_FIRST_CLAIM_V2_ENABLED", "PAYMENT_FIRST_SUCCESS_V2_ENABLED", "PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED", "PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_ENABLED", "PAYMENT_FIRST_CHECKOUT_V2_ENABLED", "PAYMENT_V2_PAYOUT_EXECUTION_ENABLED"];
const env: Record<string,string> = Object.fromEntries(gates.map((name) => [name, "true"]));
Object.assign(env, { NODE_ENV: "production", CRON_SECRET: "test", PAYMENT_V2_EVENT_INBOX_ENABLED: "false", NEXT_PUBLIC_SITE_URL: "https://www.sirensforge.vip", PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN: "https://www.sirensforge.vip", STRIPE_SECRET_KEY: "test", STRIPE_PAYMENT_V2_WEBHOOK_SECRET: "test", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" });
const effects = { capability: 0, tiers: 0, inventory: 0 };
const deps: PublicReadinessDependencies = {
  now: () => new Date("2026-08-06T00:00:00Z"),
  async loadAffiliateCapability() { effects.capability++; return true; },
  async loadTiers() { effects.tiers++; return Object.entries(LOCKED_PAYMENT_V2_PRICES).map(([name, stripe_price_id]) => ({ name, is_active: true, stripe_price_id })); },
  async loadInventoryRows() { effects.inventory++; return []; },
};

for (const value of [undefined, "", "false", "TRUE", " true", "true ", "yes", "1"]) equal(paymentFirstPublicCutoverEnabled(value), false, `cutover rejects ${String(value)}`);
equal(paymentFirstPublicCutoverEnabled("true"), true, "exact true enables cutover");
let state = await derivePublicPurchaseState({ ...env, PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED: "false" }, deps);
equal(state, { checkoutMode: "legacy" }, "disabled cutover derives legacy mode without tiers");
equal(effects.capability, 0, "legacy mode does not require 03200 capability");
state = await derivePublicPurchaseState(env, { ...deps, loadAffiliateCapability: async () => false });
equal(state.tiers?.og_throne, "unavailable", "missing 03200 capability fails closed");
state = await derivePublicPurchaseState(env, { ...deps, loadAffiliateCapability: async () => { throw new Error("missing RPC"); } });
equal(state.tiers?.early_bird, "unavailable", "03200 capability error fails closed");
for (const gate of gates) for (const value of [undefined, "", "false", "TRUE", " true", "true ", "malformed"]) {
  const changed = { ...env, [gate]: value } as Record<string,string|undefined>;
  state = await derivePublicPurchaseState(changed, deps);
  if (gate === "PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED") equal(state.checkoutMode, "legacy", `${gate} rejects ${String(value)}`);
  else equal(state.tiers?.og_throne, "unavailable", `${gate} rejects ${String(value)}`);
}
state = await derivePublicPurchaseState({ ...env, PAYMENT_V2_EVENT_INBOX_ENABLED: "true" }, deps);
equal(state.tiers?.early_bird, "unavailable", "enabled lifecycle inbox fails closed");
for (const [key, value] of [["STRIPE_SECRET_KEY", ""], ["STRIPE_PAYMENT_V2_WEBHOOK_SECRET", ""], ["SUPABASE_SERVICE_ROLE_KEY", ""], ["SUPABASE_URL", ""], ["NEXT_PUBLIC_SITE_URL", "bad"], ["PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN", "https://other.test"]] as const) {
  const changed = { ...env, [key]: value }; if (key === "SUPABASE_URL") changed.NEXT_PUBLIC_SUPABASE_URL = "";
  equal((await derivePublicPurchaseState(changed, deps)).tiers?.og_throne, "unavailable", `${key} fails closed`);
}
for (const rows of [[], [{ name: "og_throne", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.og_throne }], [{ name: "og_throne", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.og_throne }, { name: "og_throne", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.og_throne }, { name: "early_bird", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.early_bird }], [{ name: "og_throne", is_active: false, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.og_throne }, { name: "early_bird", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.early_bird }], [{ name: "og_throne", is_active: true, stripe_price_id: "" }, { name: "early_bird", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.early_bird }], [{ name: "og_throne", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.early_bird }, { name: "early_bird", is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES.og_throne }]]) {
  equal((await derivePublicPurchaseState(env, { ...deps, loadTiers: async () => rows })).tiers?.og_throne, "unavailable", "invalid tier shape/price fails closed");
}
state = await derivePublicPurchaseState(env, deps); equal(state.tiers, { og_throne: "available", early_bird: "available" }, "valid runtime state is available");
state = await derivePublicPurchaseState(env, { ...deps, loadInventoryRows: async () => Array.from({ length: 50 }, () => ({ tier: "og_throne", state: "CLAIMED", expires_at: null })) });
equal(state.tiers?.og_throne, "sold_out", "valid full inventory is sold out");
state = await derivePublicPurchaseState(env, { ...deps, loadInventoryRows: async () => { throw new Error("schema detail"); } }); equal(state.tiers?.og_throne, "unavailable", "query ambiguity is unavailable");

const legacy = readFileSync("app/api/checkout/subscription/route.ts", "utf8");
const legacyGuard = legacy.indexOf('process.env.PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED === "true"');
check(legacyGuard > 0 && legacyGuard < legacy.indexOf("  try {", legacyGuard), "legacy guard is first POST operation");
for (const token of ["supabaseServer()", "req.json()", "getOrCreateStripeCustomer(", "computePlatformFeeAmountCents(priceId", "stripe.checkout.sessions.create("]) check(legacyGuard < legacy.indexOf(token, legacyGuard), `legacy cutoff precedes ${token}`);
check(legacy.includes("PAYMENT_FIRST_LEGACY_CHECKOUT_CUTOVER") && legacy.includes("status: 503"), "legacy cutoff has stable contract");
Object.assign(process.env, { PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_local_only", SUPABASE_URL: "https://local.invalid", SUPABASE_SERVICE_ROLE_KEY: "local-test-only" });
const { POST: legacyPost } = await import("../../../app/api/checkout/subscription/route");
for (const body of ['{"tierName":"og_throne"}', '{"tierName":"early_bird"}', '{"tierName":"prime_access"}', '{', undefined]) {
  const response = await legacyPost(new Request("https://local.invalid/api/checkout/subscription", { method: "POST", ...(body === undefined ? {} : { body }) }));
  equal(response.status, 503, "every direct legacy request is cut off");
  equal(await response.json(), { error: "Checkout is unavailable during payment-first cutover", code: "PAYMENT_FIRST_LEGACY_CHECKOUT_CUTOVER" }, "every direct legacy request has one contract");
}
const pricing = readFileSync("app/pricing/PricingClient.tsx", "utf8");
check(pricing.includes('"/api/payment-v2/readiness"'), "Pricing uses one public mode/readiness boundary");
check(pricing.includes('? "/api/checkout/subscription-v2"') && pricing.includes(': "/api/checkout/subscription"'), "Pricing selects exact route from derived mode");
check(pricing.includes("...(normalizeReferralCode(referralCode) ? { referralCode"), "Payment V2 body contains only tier and optional referral code");
const v2 = readFileSync("app/api/checkout/subscription-v2/route.ts", "utf8");
check(v2.indexOf("derivePublicPurchaseState") < v2.indexOf("new Stripe(stripeKey"), "direct V2 readiness precedes Stripe construction");
check(v2.indexOf("derivePublicPurchaseState") < v2.indexOf('req.headers.get("cookie")'), "direct V2 readiness precedes cookie read");
check(v2.includes("checkRateLimit") && v2.includes("checkBotId"), "BotID and Firewall protection remain active");
const readinessRoute = readFileSync("app/api/payment-v2/readiness/route.ts", "utf8");
check(readinessRoute.includes('"Cache-Control": "no-store"'), "public response is no-store");
const publicShape = JSON.stringify(await derivePublicPurchaseState(env, deps));
for (const secret of ["PAYMENT_FIRST_", "SUPABASE", "STRIPE", "price_", "slots_remaining", "configuration", "diagnostic"]) check(!publicShape.includes(secret), `public response omits ${secret}`);
check(readinessRoute.includes('.rpc("payment_v2_affiliate_public_cutover_ready")') && readinessRoute.match(/\.rpc\(/g)?.length === 1, "readiness invokes only the boolean 03200 capability RPC");
const migration = readFileSync("supabase/migrations/20260805002900_payment_v2_lifecycle_foundation.sql", "utf8"); check(migration.length > 0, "02900 remains present for source guard only");
const status = readFileSync(".env.example", "utf8"); check(status.includes("PAYMENT_V2_EVENT_INBOX_ENABLED=false"), "inbox example remains false");
console.log(`PFC-CORE-02A focused cutover tests passed (${assertions} assertions; local fakes only, zero external calls).`);
