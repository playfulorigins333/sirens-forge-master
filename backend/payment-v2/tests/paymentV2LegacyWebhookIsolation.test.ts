import assert from "node:assert/strict";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_legacy_isolation";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_legacy_isolation";
const { handleLegacyStripeWebhook } = await import("../../../app/api/webhook/route");

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (actual: unknown, message: string) => { assert.ok(actual, message); assertions++; };
const md = { checkout_contract_version: "pfc-03-v2", payment_v2_hold_id: "10000000-0000-4000-8000-000000000004", tier_name: "og_throne" };

type Query = { table: string; op?: string };
function deps(event: any) {
  const calls = { admin: 0, retrieve: [] as string[], rpc: [] as string[], queries: [] as Query[] };
  const query = (table: string): any => {
    calls.queries.push({ table });
    const chain: any = {
      select() { calls.queries.push({ table, op: "select" }); return chain; },
      update() { calls.queries.push({ table, op: "update" }); return chain; },
      insert() { calls.queries.push({ table, op: "insert" }); return chain; },
      upsert() { calls.queries.push({ table, op: "upsert" }); return Promise.resolve({ error: null }); },
      eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    };
    return chain;
  };
  return { calls, input: {
    constructEvent() { return event; },
    getSupabaseAdmin() { calls.admin++; return { from: query, rpc(name: string) { calls.rpc.push(name); return Promise.resolve({ data: null, error: null }); } } as any; },
    async retrieveSubscription(id: string) { calls.retrieve.push(id); return { id, customer: "cus", metadata: md, items: { data: [] } }; },
  } };
}

for (const [name, event] of [
  ["checkout", { type: "checkout.session.completed", data: { object: { id: "cs_v2", mode: "payment", payment_status: "paid", metadata: md } } }],
  ["subscription", { type: "customer.subscription.updated", data: { object: { id: "sub_v2", metadata: md } } }],
  ["invoice", { type: "invoice.payment_failed", data: { object: { id: "in_v2", subscription: { id: "sub_v2", metadata: md } } } }],
] as const) {
  const h = deps(event);
  const response = await handleLegacyStripeWebhook("{}", "sig", h.input as any);
  equal(response.status, 200, `${name} Payment V2 event ignored successfully`);
  const body = await response.json();
  equal(body.code, "PAYMENT_V2_EVENT_IGNORED_BY_LEGACY_WEBHOOK", `${name} has stable ignore code`);
  equal(h.calls.admin, 0, `${name} creates no Supabase admin client`);
  equal(h.calls.retrieve, [], `${name} performs no provider subscription retrieval after isolation`);
  equal(h.calls.rpc, [], `${name} calls no affiliate RPC`);
  equal(h.calls.queries, [], `${name} performs zero profile, tier or user_subscriptions queries or writes`);
}

{
  const h = deps({ type: "checkout.session.completed", data: { object: { id: "cs_legacy", mode: "payment", payment_status: "paid", customer: "cus", metadata: { tier_name: "og_throne" } } } });
  const response = await handleLegacyStripeWebhook("{}", "sig", h.input as any);
  equal(response.status, 200, "representative legacy checkout still enters legacy path");
  equal(h.calls.admin, 1, "legacy event creates admin client");
  check(h.calls.queries.some((q) => q.table === "profiles"), "legacy event still attempts profile resolution");
}

console.log(`PFC-07E-A1 legacy webhook isolation tests passed (${assertions} assertions; no external side effects)`);
