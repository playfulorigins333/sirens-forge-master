import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { affiliateSummaryResponse } from "../../../app/api/affiliate/summary/route";
import { createStripeConnectResponse } from "../../../app/api/stripe/connect/create/route";
process.env.STRIPE_SECRET_KEY = "sk_test_local_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_only";
const { handleLegacyStripeWebhook } = await import("../../../app/api/webhook/route");

let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions++; };
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const files = (path: string) => readFileSync(path, "utf8");

let adminConstructions = 0;
let response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => null, getAdminClient: () => { adminConstructions++; return {}; } });
equal(response.status, 401, "unauthenticated summary is 401"); equal(adminConstructions, 0, "admin is not constructed before authentication");

const queryLog: Array<{ table: string; columns: string; filters: Array<[string,string]> }> = [];
const data: Record<string, any[]> = {
  profiles: [{ id: "profile-1", user_id: "user-1", referral_code: "SAFE1", tier: "early_bird", stripe_connect_onboarded: true }],
  user_subscriptions: [{ tier_name: "early_bird", status: "active", created_at: "2026-01-01" }],
  referrals: [{ referred_user_id: "other", used_at: "2026-01-02", status: "complete" }],
  commission_earnings: [{ id: "earning", commission_amount: 12, status: "pending", created_at: "2026-01-03", payout_date: null, referred_user_id: "other", referral_id: "ref" }],
  affiliate_ledger: [{ id: "ledger", referred_user_id: null, commission_amount_cents: 600, gross_amount_cents: 2999, commission_percent: 20, status: "pending", created_at: "2026-01-04", payment_v2_purchase_id: "purchase", attribution_status: "PURCHASER_UNCLAIMED" }],
  referral_codes: [{ total_uses: 3, user_id: "user-1" }],
  affiliate_payout_items: [{ amount_cents: 500, created_at: "2026-01-04", affiliate_payout_batches: [{ status: "paid", created_at: "2026-01-05" }] }],
};
const admin = { from(table: string) { const entry = { table, columns: "", filters: [] as Array<[string,string]> }; queryLog.push(entry); const chain: any = {
  select(columns: string) { entry.columns = columns; return chain; }, eq(column: string, value: string) { entry.filters.push([column, value]); return chain; }, order() { return chain; }, limit() { return chain; },
  then(resolve: any) { return Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve); },
}; return chain; } };
response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => "user-1", getAdminClient: () => { adminConstructions++; return admin; } });
equal(response.status, 200, "authenticated summary succeeds");
equal(response.headers.get("cache-control"), "no-store", "summary is no-store");
const summary = await response.json();
equal(summary.pending, 18, "legacy and Payment V2 pending totals remain visible"); equal(summary.clicks, 4, "paid V2 usage is derived without mutating the code counter"); equal(summary.total_referrals, 2, "verified Payment V2 referral is counted"); equal(summary.payouts.length, 1, "payout history remains visible"); equal(summary.stripe_connect_onboarded, true, "Connect boolean remains visible");
for (const prohibited of ["email", "stripe_customer_id", "stripe_subscription_id", "stripe_connect_account_id", "tokens", "role", "seat_number", "is_tester"]) check(!JSON.stringify(summary).includes(prohibited), `summary omits ${prohibited}`);
for (const query of queryLog) { check(query.columns !== "*" && query.columns.length > 0, `${query.table} uses explicit columns`); check(query.filters.length > 0, `${query.table} is owner scoped`); }
equal(queryLog.map((q) => q.table), ["profiles", "user_subscriptions", "referrals", "commission_earnings", "affiliate_ledger", "referral_codes", "affiliate_payout_items"], "summary reads only exact manifest tables");
check(!queryLog.find((q) => q.table === "referrals")?.columns.includes("used_at"), "summary avoids nonexistent referrals.used_at");
check(!queryLog.find((q) => q.table === "commission_earnings")?.columns.includes("payout_date"), "summary avoids nonexistent commission payout_date");

const effects = { auth: 0, admin: 0, config: 0, stripe: 0 };
response = await createStripeConnectResponse(new Request("https://local.test", { method: "POST" }), {
  getAuthenticatedUserId: async () => { effects.auth++; return null; }, getAdminClient: () => { effects.admin++; return {}; },
  getConfiguration: () => { effects.config++; return {}; }, createStripeClient: () => { effects.stripe++; return {} as any; },
});
equal(response.status, 401, "Connect remains authentication protected"); equal(effects, { auth: 1, admin: 0, config: 0, stripe: 0 }, "Connect no longer has a cutover pause and still authenticates before effects");

function webhook(event: any, rpcResult: any = { data: null, error: null }) { const calls = { admin: 0, rpc: [] as string[], writes: 0 }; const chain: any = { select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; }, maybeSingle: async () => ({ data: null, error: null }), upsert: async () => ({ error: null }), update() { calls.writes++; return chain; }, insert() { calls.writes++; return chain; } }; return { calls, deps: {
  constructEvent: () => event, getSupabaseAdmin: () => { calls.admin++; return { from: () => chain, rpc: async (name: string) => { calls.rpc.push(name); if (rpcResult instanceof Error) throw rpcResult; return rpcResult; } } as any; }, retrieveSubscription: async () => ({})
} }; }
const destination = { connect_mode: "destination_charge", connect_destination_account: "acct" };
for (const type of ["customer.subscription.created", "customer.subscription.updated", "invoice.payment_succeeded"]) { const h = webhook({ type, data: { object: { id: "x", customer: "cus", metadata: destination, items: { data: [] } } } }); response = await handleLegacyStripeWebhook("{}", "sig", h.deps); equal(response.status, 200, `${type} release succeeds`); equal(h.calls.rpc, ["release_affiliate_commissions"], `${type} releases exactly once`); }
for (const failure of [{ data: null, error: new Error("database secret") }, new Error("thrown secret"), null, {}]) { const h = webhook({ type: "invoice.payment_succeeded", data: { object: { metadata: destination } } }, failure); response = await handleLegacyStripeWebhook("{}", "sig", h.deps); equal(response.status, 500, "release failure is 500"); equal(await response.json(), { error: "Unable to release affiliate commissions", code: "AFFILIATE_COMMISSION_RELEASE_FAILED" }, "release failure is stable and secret-free"); }
for (const event of [{ type: "customer.subscription.deleted", data: { object: { id: "sub" } } }, { type: "invoice.payment_failed", data: { object: { subscription: "sub" } } }]) { const h = webhook(event); response = await handleLegacyStripeWebhook("{}", "sig", h.deps); equal(response.status, 200, "deferred lifecycle path acknowledges"); equal(h.calls.rpc, [], "deferred lifecycle path invokes no RPC"); equal(h.calls.writes, 0, "deferred lifecycle path performs no affiliate write"); }

const dashboard = files("app/affiliate/page.tsx"); for (const token of ["supabaseBrowser", '.from("profiles")', '.from("user_subscriptions")', '.from("affiliate_payout_items")', 'select("*")']) check(!dashboard.includes(token), `dashboard excludes ${token}`);
check(dashboard.includes('fetch("/api/affiliate/summary"'), "dashboard uses authenticated summary"); check(!dashboard.includes("Affiliate program paused"), "dashboard pause notice is removed"); check(dashboard.includes('checkoutMode === "payment_v2"'), "referral sharing supports Payment V2");
const pricing = files("app/pricing/PricingClient.tsx"); check(!pricing.includes('removeItem("sf_referral_code")'), "Payment V2 preserves stored referral"); check(pricing.includes("if (!publicPurchase) return"), "unresolved mode captures no referral"); check(pricing.includes("...(referralCode ? { referralCode"), "V2 request submits an optional normalized referral"); check(!pricing.includes("Referral codes are not accepted or tracked"), "Pricing pause copy is removed");
const home = files("app/page.tsx"); check(!home.includes("Affiliate referrals are currently paused"), "homepage pause copy is removed");
const terms = files("app/affiliate-terms/page.tsx"); check(terms.includes('lastUpdated="August 7, 2026"') && terms.includes("Payment-First Affiliate Attribution"), "terms describe restored attribution");
const webhookSource = files("app/api/webhook/route.ts"); check(!webhookSource.includes('rpc("void_affiliate_commissions"'), "nonexistent void RPC calls are removed"); check(webhookSource.includes("deferAffiliateVoidProcessing"), "one explicit deferred no-op boundary exists");
for (const prohibited of ["clawback_affiliate_commission", "payment_v2_inbox", "refund processor", "dispute processor"]) check(!webhookSource.includes(prohibited), `webhook adds no ${prohibited}`);
console.log(`PFC-CORE-03B affiliate restoration tests passed (${assertions} assertions; local fakes only, zero external calls).`);
