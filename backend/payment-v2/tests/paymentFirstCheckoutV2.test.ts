import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { paymentFirstCheckout, PAYMENT_V2_CONTRACT_VERSION, PAYMENT_V2_COOKIE, PAYMENT_V2_HOLD_MINUTES, type CheckoutDependencies } from "../../../lib/payment-v2/checkoutService";
import { LOCKED_PAYMENT_V2_PRICES } from "../../../lib/payment-v2/publicPurchaseReadiness";
import { MATERIAL_POLICY_MANIFEST } from "../../../lib/material-policy/manifest";

let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions++; };
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const fixedRaw = Buffer.alloc(32, 7);
const holdId = "10000000-0000-0000-0000-000000000003";

function harness(overrides: Partial<CheckoutDependencies> = {}) {
  const calls = { tier: [] as unknown[], acquire: [] as unknown[], create: [] as unknown[], associate: [] as unknown[], retrieve: [] as unknown[] };
  const deps: CheckoutDependencies = {
    now: () => new Date("2026-08-02T00:00:00Z"), randomCredential: () => Buffer.from(fixedRaw),
    async loadTier(name) { calls.tier.push(name); return [{ name, is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES[name] }]; },
    async acquireHold(hash, tier, expiresAt) { calls.acquire.push([Buffer.from(hash), tier, expiresAt]); return { holdId, state: "HELD", expiresAt: "2026-08-02T01:00:00.000Z" }; },
    async recordPolicyAcceptance() { return "20000000-0000-0000-0000-000000000001"; },
    async loadAssociatedSessionId() { return "cs_existing"; },
    async associateSession(id, hash, session) { calls.associate.push([id, Buffer.from(hash), session]); return "associated"; },
    async createSession(params, key) { calls.create.push([params, key]); return { id: "cs_new", url: "https://checkout.stripe.test/new" }; },
    async retrieveSession(id) { calls.retrieve.push(id); return { id, url: "https://checkout.stripe.test/existing", status: "open", payment_status: "unpaid", expires_at: 1785636000, metadata: { payment_v2_hold_id: holdId, tier_name: "og_throne", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION } }; },
    ...overrides,
  };
  const run = (body: unknown = { tierName: "og_throne" }, more: Record<string, unknown> = {}) => paymentFirstCheckout({ enabled: "true", body: body && typeof body === "object" && !Array.isArray(body) ? { ...body, materialPolicyAcceptance: { accepted: true, materialBundleVersion: MATERIAL_POLICY_MANIFEST.materialBundleVersion } } : body, production: true, configuredOrigin: "https://sirensforge.com", ...more }, deps);
  return { calls, deps, run };
}

{
  const h = harness({ randomCredential: () => { throw new Error("must not run"); }, loadTier: async () => { throw new Error("must not run"); } });
  const result = await paymentFirstCheckout({ enabled: undefined, body: { tierName: "og_throne" }, production: true, baseUrl: "" }, h.deps);
  equal(result.status, 503, "disabled is 503"); equal(result.body.code, "PAYMENT_FIRST_CHECKOUT_V2_DISABLED", "stable disabled code");
  equal(h.calls.acquire.length, 0, "disabled makes zero database acquisitions"); equal(h.calls.create.length, 0, "disabled makes zero Stripe calls");
}

for (const body of [null, {}, { tierName: "prime_access" }, { tierName: "bad" }, { tierName: "og_throne", priceId: "price_evil" }, { tierName: "og_throne", amount: 1 }, { tierName: "og_throne", userId: "x" }, { tierName: "og_throne", profileId: "x" }, { tierName: "og_throne", referralCode: "!" }]) {
  const result = await harness().run(body); equal(result.status, 400, `invalid request fails: ${JSON.stringify(body)}`);
}

{
  const h = harness(); const result = await h.run(); equal(result.status, 200, "OG accepted");
  const params = h.calls.create[0][0] as any; equal(params.mode, "payment", "OG payment mode"); equal(params.customer_creation, "always", "OG creates Customer");
  equal(params.line_items.length, 1, "one line item"); equal(params.line_items[0].price, LOCKED_PAYMENT_V2_PRICES.og_throne, "authoritative price"); equal(params.line_items[0].quantity, 1, "quantity one");
  equal(params.metadata, { payment_v2_hold_id: holdId, tier_name: "og_throne", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION }, "safe metadata only");
  equal(params.payment_intent_data, { metadata: params.metadata }, "OG propagates Payment V2 discriminator to PaymentIntent metadata");
  equal(params.subscription_data, undefined, "OG does not receive subscription_data");
  check(!JSON.stringify(params).includes(fixedRaw.toString("base64url")), "raw credential absent from Stripe"); check(!JSON.stringify(params).includes(createHash("sha256").update(fixedRaw).digest("hex")), "hash absent from Stripe");
  equal(result.body, { url: "https://checkout.stripe.test/new" }, "JSON contains URL only"); equal(result.cookie?.name, PAYMENT_V2_COOKIE, "V2 cookie name");
  equal(result.cookie?.httpOnly, true, "HttpOnly cookie"); equal(result.cookie?.sameSite, "lax", "SameSite Lax"); equal(result.cookie?.secure, true, "Secure in production"); equal(result.cookie?.path, "/", "root cookie path"); check((result.cookie?.maxAge || 0) >= 60 * 60 * 24 * 30, "cookie has claim lifetime");
  const dbHash = h.calls.acquire[0][0] as Buffer; equal(dbHash.length, 32, "database receives 32-byte hash"); equal(dbHash, createHash("sha256").update(fixedRaw).digest(), "database receives SHA-256 only");
  equal(h.calls.associate[0][0], holdId, "association exact hold"); equal(h.calls.associate[0][1], dbHash, "association exact hash"); equal(h.calls.associate[0][2], "cs_new", "association exact Session");
  equal(h.calls.create[0][1], `payment-v2:${PAYMENT_V2_CONTRACT_VERSION}:hold:${holdId}`, "stable hold idempotency key"); check(!String(h.calls.create[0][1]).includes("buyer"), "idempotency key contains no buyer identity");
  check(String(params.success_url).includes("{CHECKOUT_SESSION_ID}"), "server success URL carries literal Session placeholder"); check(!JSON.stringify(params).includes("paid"), "redirect config is not payment proof");
  equal(params.expires_at, 1785632400, "exact database-returned expiration is sent to Stripe");
  equal(params.expires_at - 1785628800, 60 * 60, "new hold creates a 60-minute rather than default 24-hour Session");
}

{
  const h = harness(); const result = await h.run({ tierName: "early_bird" }); equal(result.status, 200, "Early Bird accepted");
  const params = h.calls.create[0][0] as any; equal(params.mode, "subscription", "Early Bird subscription mode"); equal(params.customer_creation, undefined, "subscription lets Stripe create Customer");
  equal(params.metadata, { payment_v2_hold_id: holdId, tier_name: "early_bird", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION }, "Early Bird Session metadata contains discriminator");
  equal(params.subscription_data, { metadata: params.metadata }, "Early Bird propagates Payment V2 discriminator to Subscription metadata");
  equal(params.payment_intent_data, undefined, "Early Bird does not receive payment_intent_data");
}

for (const [tierName, commissionPercent] of [["og_throne", 25], ["og_throne", 10]] as const) {
  const h = harness({
    acquireHold: async (_hash, _tier, _expires, code) => { equal(code, "SAFE_CODE", "normalized referral reaches authoritative hold RPC"); return { holdId, state: "HELD", expiresAt: "2026-08-02T01:00:00.000Z", connectDestination: "acct_authoritative", commissionPercent }; },
    loadPriceUnitAmount: async () => 9999,
  });
  const result = await h.run({ tierName, referralCode: "safe_code" }); equal(result.status, 200, "connected one-time referral starts Checkout");
  const params = h.calls.create[0][0] as any;
  equal(params.payment_intent_data, { metadata: params.metadata }, "referred one-time purchase remains a platform charge");
  check(!JSON.stringify(params).includes("transfer_data") && !JSON.stringify(params).includes("application_fee"), "one-time Checkout moves no affiliate funds");
  equal(Object.keys(params.metadata).sort(), ["checkout_contract_version", "payment_v2_hold_id", "tier_name"], "affiliate truth is absent from Stripe metadata");
}

for (const commissionPercent of [50, 20] as const) {
  const h = harness({ acquireHold: async () => ({ holdId, state: "HELD", expiresAt: "2026-08-02T01:00:00.000Z", connectDestination: "acct_authoritative", commissionPercent }) });
  const result = await h.run({ tierName: "early_bird", referralCode: "CODE-1" }); equal(result.status, 200, "connected subscription referral starts Checkout");
  const params = h.calls.create[0][0] as any;
  equal(params.subscription_data, { metadata: params.metadata }, "referred subscription remains a platform charge");
  check(!JSON.stringify(params).includes("transfer_data") && !JSON.stringify(params).includes("application_fee"), "subscription Checkout moves no affiliate funds");
}

{
  const h = harness({ acquireHold: async () => ({ holdId, state: "HELD", expiresAt: "2026-08-02T01:00:00.000Z", connectDestination: null, commissionPercent: 50 }) });
  await h.run({ tierName: "early_bird", referralCode: "CODE-1" });
  equal((h.calls.create[0][0] as any).subscription_data, { metadata: (h.calls.create[0][0] as any).metadata }, "unconnected affiliate preserves attribution without an unsafe destination");
}

{
  const encoded = Buffer.alloc(32, 9).toString("base64url"); const h = harness(); const result = await h.run(undefined, { cookie: encoded });
  equal(result.cookie?.value, encoded, "valid cookie reused"); equal(h.calls.acquire[0][0], createHash("sha256").update(Buffer.alloc(32, 9)).digest(), "reused cookie hash reaches database");
  const malformed = await harness().run(undefined, { cookie: "malformed" }); equal(malformed.cookie?.value, fixedRaw.toString("base64url"), "malformed cookie replaced");
}

{
  const originalExpiration = "2026-08-02T00:45:17.000Z";
  const h = harness({ acquireHold: async () => ({ holdId, state: "HELD", expiresAt: originalExpiration }) });
  await h.run();
  equal((h.calls.create[0][0] as any).expires_at, 1785631517, "existing HELD retry preserves its original expiration");
  check((h.calls.create[0][0] as any).expires_at !== 1785632400, "service does not replace reused expiration with now plus 60 minutes");
}

{
  const h = harness({ acquireHold: async () => ({ holdId, state: "HELD", expiresAt: "2026-08-02T00:29:59.000Z" }) });
  const result = await h.run();
  equal(result.status, 409, "under-30-minute hold is rejected"); equal(result.body.code, "HOLD_TOO_CLOSE_TO_EXPIRY", "short hold has stable code");
  equal(h.calls.create.length, 0, "short hold makes no Stripe call"); check(Boolean(result.cookie), "short hold preserves purchaser cookie");
}

{
  let committedHash: Buffer | null = null; let uncertain = true;
  const h = harness({ async acquireHold(hash) {
    if (uncertain) { committedHash = Buffer.from(hash); uncertain = false; throw new Error("uncertain transport failure"); }
    equal(Buffer.from(hash), committedHash, "same-cookie retry recovers the committed purchaser hold");
    return { holdId, state: "HELD", expiresAt: "2026-08-02T01:00:00.000Z" };
  } });
  const first = await h.run();
  equal(first.status, 500, "uncertain acquisition is sanitized server error"); equal(first.cookie?.value, fixedRaw.toString("base64url"), "uncertain acquisition preserves exact cookie");
  equal(h.calls.create.length, 0, "uncertain acquisition makes zero Stripe calls");
  const recovered = await h.run(undefined, { cookie: first.cookie?.value });
  equal(recovered.status, 200, "subsequent same-cookie request recovers effective hold"); equal(h.calls.create.length, 1, "recovery creates only one Session");
}

{
  const valid = harness(); await valid.run(undefined, { configuredOrigin: "https://checkout.sirensforge.test///", headers: { host: "evil.test", "x-forwarded-host": "also-evil.test" } });
  const params = valid.calls.create[0][0] as any;
  equal(params.success_url, "https://checkout.sirensforge.test/billing/success?session_id={CHECKOUT_SESSION_ID}", "trusted Production HTTPS origin is normalized");
  equal(params.cancel_url, "https://checkout.sirensforge.test/billing/cancel", "spoofed request hosts cannot alter redirects");
  for (const [configuredOrigin, label] of [[undefined, "missing"], ["http://sirensforge.test", "Production HTTP"], ["https://user:pass@sirensforge.test", "credentialed"], ["https://sirensforge.test?x=1", "query"], ["https://sirensforge.test/#x", "fragment"]] as const) {
    const h = harness(); const result = await h.run(undefined, { configuredOrigin });
    equal(result.status, 500, `${label} origin fails closed`); equal(h.calls.acquire.length, 0, `${label} origin fails before hold acquisition`);
  }
}

for (const [rows, label] of [[[], "missing"], [[{ name: "og_throne", is_active: true, stripe_price_id: "a" }, { name: "og_throne", is_active: true, stripe_price_id: "b" }], "duplicate"], [[{ name: "og_throne", is_active: false, stripe_price_id: "a" }], "inactive"], [[{ name: "og_throne", is_active: true, stripe_price_id: " " }], "blank price"]] as const) {
  const result = await harness({ loadTier: async () => rows as any }).run(); equal(result.status, 500, `${label} tier fails closed`);
}

for (const [message, code] of [["sold_out", "TIER_SOLD_OUT"], ["effective_hold_conflict", "EFFECTIVE_HOLD_CONFLICT"]]) {
  const result = await harness({ acquireHold: async () => { throw new Error(message); } }).run(); equal(result.status, 409, `${message} is conflict`); equal(result.body.code, code, `${message} stable code`);
}

{
  const result = await harness({ createSession: async () => { throw new Error("secret raw provider error"); } }).run(); equal(result.status, 500, "Stripe failure sanitized"); check(Boolean(result.cookie), "cookie preserved after acquired hold and Stripe failure"); check(!JSON.stringify(result.body).includes("secret"), "provider error absent");
  const association = await harness({ associateSession: async () => "session_conflict" }).run(); equal(association.status, 500, "association failure errors"); equal(association.body.url, undefined, "association failure returns no URL"); check(Boolean(association.cookie), "association failure preserves cookie");
}

{
  const h = harness({ acquireHold: async () => ({ holdId, state: "SESSION_ASSOCIATED", expiresAt: "2026-08-02T01:00:00.000Z" }) }); const result = await h.run(); equal(result.status, 200, "associated exact retry succeeds");
  equal(h.calls.create.length, 0, "associated retry creates no Session"); equal(h.calls.retrieve, ["cs_existing"], "retrieves exact stored Session");
  for (const session of [
    { id: "cs_existing", url: "u", status: "complete", payment_status: "paid", expires_at: 1785636000, metadata: { payment_v2_hold_id: holdId, tier_name: "og_throne", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION } },
    { id: "cs_existing", url: "u", status: "open", payment_status: "unpaid", expires_at: 1, metadata: { payment_v2_hold_id: holdId, tier_name: "og_throne", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION } },
    { id: "cs_existing", url: "u", status: "open", payment_status: "unpaid", expires_at: 1785636000, metadata: { payment_v2_hold_id: "wrong", tier_name: "og_throne", checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION } },
  ]) { const rejected = await harness({ acquireHold: async () => ({ holdId, state: "SESSION_ASSOCIATED", expiresAt: "2026-08-02T01:00:00.000Z" }), retrieveSession: async () => session }).run(); equal(rejected.status, 500, "unsafe associated Session fails closed"); equal(rejected.body.url, undefined, "unsafe Session URL withheld"); }
}

{
  const h = harness();
  const result = await h.run({ tierName: "og_throne", referralCode: " safe_code " });
  equal(result.status, 400, "referral fails closed");
  equal(result.body.code, "INVALID_CHECKOUT_REQUEST", "referral has stable invalid-request code");
  equal(h.calls.acquire.length, 0, "referral acquires no hold");
  equal(h.calls.create.length, 0, "referral creates no Stripe Session or related provider operation");
  check(!JSON.stringify(h.calls.create).includes("destination"), "referral constructs no destination");
  check(!JSON.stringify(h.calls.create).includes("application_fee"), "referral constructs no application fee");
}

{
  const h = harness(); await h.run(); const expires = new Date(h.calls.acquire[0][2] as string); equal(expires.toISOString(), "2026-08-02T01:00:00.000Z", `${PAYMENT_V2_HOLD_MINUTES}-minute hold`);
  const route = readFileSync("app/api/checkout/subscription-v2/route.ts", "utf8"); check(!route.includes("auth.getUser"), "route never calls auth.getUser"); check(!route.includes("getOrCreateStripeCustomer"), "route requires no profile customer"); check(!route.includes("user_subscriptions"), "route creates no entitlement"); check(!route.includes("payment_v2_record_paid"), "route writes no paid state");
}

console.log(`PFC-03 payment-first Checkout V2 tests passed (${assertions} assertions; no external network calls)`);
