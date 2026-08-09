import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { affiliateSummaryResponse } from "../../../app/api/affiliate/summary/route";
import { createStripeConnectResponse } from "../../../app/api/stripe/connect/create/route";
import { affiliatePayoutThresholdState } from "../../../app/affiliate/page";
process.env.STRIPE_SECRET_KEY = "sk_test_local_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_only";
const { handleLegacyStripeWebhook } = await import("../../../app/api/webhook/route");

let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions++; };
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const files = (path: string) => readFileSync(path, "utf8");

let adminConstructions = 0;
let authClientConstructions = 0;
let response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => null, getAuthenticatedClient: async () => { authClientConstructions++; return {}; }, getAdminClient: () => { adminConstructions++; return {}; } });
equal(response.status, 401, "unauthenticated summary is 401"); equal(adminConstructions, 0, "admin is not constructed before authentication"); equal(authClientConstructions, 0, "authenticated data client is not obtained before authentication");

const baseData: Record<string, any[]> = {
  profiles: [{ id: "profile-1", user_id: "user-1", referral_code: "SAFE1", tier: "early_bird", stripe_connect_onboarded: true }],
  user_subscriptions: [{ tier_name: "early_bird", status: "active", created_at: "2026-01-01" }],
  referrals: [{ referred_user_id: "other", used_at: "2026-01-02", status: "complete" }],
  commission_earnings: [{ id: "earning", commission_amount: 12, status: "pending", created_at: "2026-01-03", payout_date: null, referred_user_id: "other", referral_id: "ref" }],
  referral_codes: [{ total_uses: 3, user_id: "user-1" }],
  affiliate_payout_items: [{ amount_cents: 500, created_at: "2026-01-04", affiliate_payout_batches: [{ status: "paid", created_at: "2026-01-05" }] }],
};
type QueryEntry = { table: string; columns: string; filters: Array<[string,string]> };
function adminFixture(overrides: Record<string, any[]> = {}) {
  const queryLog: QueryEntry[] = [];
  const data = { ...baseData, ...overrides };
  const admin = { from(table: string) { const entry = { table, columns: "", filters: [] as Array<[string,string]> }; queryLog.push(entry); const chain: any = {
    select(columns: string) { entry.columns = columns; return chain; }, eq(column: string, value: string) { entry.filters.push([column, value]); return chain; }, order() { return chain; }, limit() { return chain; },
    then(resolve: any) { return Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve); },
  }; return chain; } };
  return { admin, queryLog, data };
}
const ledgerRows = [
  { id: "ledger-legacy", commission_amount_cents: 300, status: "pending", created_at: "2026-01-03", is_initial_payment_v2_purchase: false, is_void_self_referral: false },
  { id: "ledger-initial", commission_amount_cents: 600, status: "pending", created_at: "2026-01-04", is_initial_payment_v2_purchase: true, is_void_self_referral: false },
  { id: "ledger-recurring", commission_amount_cents: 4900, status: "available", created_at: "2026-01-05", is_initial_payment_v2_purchase: false, is_void_self_referral: false },
  { id: "ledger-paid", commission_amount_cents: 250, status: "paid", created_at: "2026-01-06", is_initial_payment_v2_purchase: false, is_void_self_referral: false },
  { id: "ledger-self", commission_amount_cents: 9999, status: "available", created_at: "2026-01-07", is_initial_payment_v2_purchase: true, is_void_self_referral: true },
];
const normal = adminFixture(); const rpcLog: string[] = [];
response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => "user-1", getAuthenticatedClient: async () => ({ async rpc(name: string) { rpcLog.push(name); return { data: ledgerRows, error: null }; } }), getAdminClient: () => normal.admin });
equal(response.status, 200, "authenticated summary succeeds"); equal(response.headers.get("cache-control"), "no-store", "summary is no-store");
const summary = await response.json();
equal(rpcLog, ["get_my_affiliate_ledger_summary"], "normal path uses the authenticated ledger summary RPC");
check(!normal.queryLog.some((q) => q.table === "affiliate_ledger"), "normal path never directly reads affiliate_ledger");
equal(summary.pending, 70, "historical pending plus legacy, initial, recurring, and available ledger totals remain visible");
equal(summary.paid, 2.5, "paid ledger totals remain visible"); equal(summary.total_earnings, 2.5, "paid earnings remain visible");
equal(summary.payout_eligible_balance, 49, "only non-void available ledger money is payout eligible");
equal(summary.total_referrals, 2, "only initial non-self Payment V2 purchase increments referrals");
equal(summary.commissions.find((item: any) => item.id === "ledger-legacy")?.commission_amount, 3, "legacy ledger cents normalize to dollars");
equal(summary.commissions.find((item: any) => item.id === "ledger-initial")?.commission_amount, 6, "initial Payment V2 cents normalize to dollars");
equal(summary.commissions.find((item: any) => item.id === "ledger-recurring")?.commission_amount, 49, "recurring Payment V2 cents normalize to dollars");
equal(summary.commissions.find((item: any) => item.id === "earning"), baseData.commission_earnings[0], "historical commission earnings remain unchanged");
equal(summary.payouts, baseData.affiliate_payout_items, "historical payout history remains unchanged");
equal(affiliatePayoutThresholdState(49), { remainingToThreshold: 1, thresholdMet: false }, "$49 available does not meet threshold");
equal(affiliatePayoutThresholdState(50), { remainingToThreshold: 0, thresholdMet: true }, "$50 available meets threshold");
check(summary.pending >= 50 && !affiliatePayoutThresholdState(summary.payout_eligible_balance).thresholdMet, "immature pending money does not satisfy payout threshold");
const normalizedLedger = summary.commissions.filter((item: any) => String(item.id).startsWith("ledger-"));
for (const item of normalizedLedger.filter((item: any) => item.id !== "ledger-self")) check(item.commission_amount > 0, `${item.id} recent activity has a nonzero amount`);
for (const secret of ["commission_amount_cents", "payment_v2_purchase_id", "payment_v2_recurring_invoice_id", "affiliate_user_id", "attribution_status", "stripe_event_id", "referral_code_id"]) check(!JSON.stringify(summary).includes(secret), `summary omits raw ledger identifier ${secret}`);
for (const query of normal.queryLog) { check(query.columns !== "*" && query.columns.length > 0, `${query.table} uses explicit columns`); check(query.filters.length > 0, `${query.table} is owner scoped`); }

const fallbackLedger = [{ id: "fallback-legacy", commission_amount_cents: 425, status: "available", created_at: "2026-01-08", payment_v2_purchase_id: null, attribution_status: null }];
const fallback = adminFixture({ affiliate_ledger: fallbackLedger });
response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => "user-1", getAuthenticatedClient: async () => ({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) }), getAdminClient: () => fallback.admin });
equal(response.status, 200, "PGRST202 missing-schema condition uses compatibility fallback"); const fallbackSummary = await response.json();
const fallbackQuery = fallback.queryLog.find((q) => q.table === "affiliate_ledger"); check(Boolean(fallbackQuery), "missing RPC invokes ledger fallback");
equal(fallbackQuery?.columns, "id,commission_amount_cents,status,created_at,payment_v2_purchase_id,attribution_status", "fallback selects only approved columns");
equal(fallbackQuery?.filters, [["affiliate_user_id", "profile-1"]], "fallback is scoped to the authenticated profile");
equal(fallbackSummary.commissions.find((item: any) => item.id === "fallback-legacy")?.commission_amount, 4.25, "fallback legacy ledger cents normalize to dollars");

for (const rpcError of [{ code: "42501", message: "permission denied" }, { code: "XX000", message: "database failure" }, { code: "PGRST116", message: "profile failure" }]) {
  const denied = adminFixture({ affiliate_ledger: fallbackLedger });
  response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => "user-1", getAuthenticatedClient: async () => ({ rpc: async () => ({ data: null, error: rpcError }) }), getAdminClient: () => denied.admin });
  equal(response.status, 500, `${rpcError.code} RPC error fails closed`); equal(await response.json(), { error: "Unable to load affiliate history" }, `${rpcError.code} returns generic summary error`); check(!denied.queryLog.some((q) => q.table === "affiliate_ledger"), `${rpcError.code} does not use fallback`);
}
const malformed = adminFixture(); response = await affiliateSummaryResponse({ getAuthenticatedUserId: async () => "user-1", getAuthenticatedClient: async () => ({ rpc: async () => ({ data: {}, error: null }) }), getAdminClient: () => malformed.admin });
equal(response.status, 500, "malformed RPC response fails closed"); check(!malformed.queryLog.some((q) => q.table === "affiliate_ledger"), "malformed response does not use fallback");

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
check(dashboard.includes('fetch("/api/affiliate/summary"'), "dashboard uses authenticated summary"); check(!dashboard.includes("Affiliate program paused"), "dashboard pause notice is removed"); check(dashboard.includes('checkoutMode === "payment_v2"'), "referral sharing supports Payment V2"); check(dashboard.includes("Eligible commissions can be sent to your connected account during scheduled payout runs."), "dashboard describes scheduled Stripe payouts accurately"); check(dashboard.includes("Number(item.commission_amount || 0)"), "recent activity renders normalized commission_amount");
const pricing = files("app/pricing/PricingClient.tsx"); check(pricing.includes("if (!publicPurchase) return"), "unresolved mode captures no referral"); check(pricing.includes("...(normalizeReferralCode(referralCode) ? { referralCode"), "V2 request submits only a current normalized referral"); check(!pricing.includes("Referral codes are not accepted or tracked"), "Pricing pause copy is removed");
const home = files("app/page.tsx"); check(!home.includes("Affiliate referrals are currently paused"), "homepage pause copy is removed");
const terms = files("app/affiliate-terms/page.tsx"); check(terms.includes('lastUpdated="August 7, 2026"') && terms.includes("Payment-First Affiliate Attribution"), "terms describe restored attribution");
const webhookSource = files("app/api/webhook/route.ts"); check(!webhookSource.includes('rpc("void_affiliate_commissions"'), "nonexistent void RPC calls are removed"); check(webhookSource.includes("deferAffiliateVoidProcessing"), "one explicit deferred no-op boundary exists");
for (const prohibited of ["clawback_affiliate_commission", "payment_v2_inbox", "refund processor", "dispute processor"]) check(!webhookSource.includes(prohibited), `webhook adds no ${prohibited}`);
console.log(`PFC-CORE-03B affiliate restoration tests passed (${assertions} assertions; local fakes only, zero external calls).`);
