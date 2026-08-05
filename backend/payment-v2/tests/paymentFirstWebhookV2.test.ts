import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { paymentFirstWebhook, PAYMENT_V2_WEBHOOK_CONTRACT, type PaymentV2Database, type PaymentV2Provider, type StripeEvent, type StripeSession, type WebhookInput } from "../../../lib/payment-v2/webhookService";

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (actual: unknown, message: string) => { assert.ok(actual, message); assertions++; };
const holdId = "10000000-0000-4000-8000-000000000004";
const hash = Uint8Array.from({ length: 32 }, (_, i) => i);
const md = { checkout_contract_version: PAYMENT_V2_WEBHOOK_CONTRACT, payment_v2_hold_id: holdId, tier_name: "og_throne" };

function harness(overrides: { event?: Partial<StripeEvent>; session?: Partial<StripeSession>; provider?: Partial<PaymentV2Provider>; db?: Partial<PaymentV2Database>; input?: Partial<WebhookInput> } = {}) {
  const calls = { body: 0, provider: 0, database: 0, construct: [] as unknown[][], session: [] as string[], pi: [] as string[], sub: [] as string[], hold: [] as string[], tier: [] as string[], purchase: [] as string[], paid: [] as Record<string, unknown>[], terminal: [] as Record<string, unknown>[] };
  const event: StripeEvent = { id: "evt_exact", type: "checkout.session.completed", created: 1785628800, data: { object: { id: "cs_exact", metadata: md } }, ...overrides.event };
  const session: StripeSession = { id: "cs_exact", mode: "payment", status: "complete", payment_status: "paid", customer: "cus_exact", payment_intent: "pi_exact", subscription: null, amount_total: 2500, currency: "usd", metadata: md,
    line_items: { data: [{ quantity: 1, amount_total: 2500, price: { id: "price_og", unit_amount: 2500, currency: "usd" } }] }, ...overrides.session };
  const provider: PaymentV2Provider = {
    constructEvent(raw, signature, secret) { calls.construct.push([raw, signature, secret]); return event; },
    async retrieveSession(id) { calls.session.push(id); return session; },
    async retrievePaymentIntent(id) { calls.pi.push(id); return { id: "pi_exact", status: "succeeded", customer: "cus_exact", amount: 2500, currency: "usd" }; },
    async retrieveSubscription(id) { calls.sub.push(id); return { id: "sub_exact", customer: "cus_exact", status: "active", items: { data: [{ quantity: 1, price: { id: "price_early" } }] }, latest_invoice: { status: "paid", paid: true, amount_due: 900, amount_paid: 900 } }; },
    ...overrides.provider,
  };
  const db: PaymentV2Database = {
    async loadHold(id) { calls.hold.push(id); return [{ id: holdId, state: "SESSION_ASSOCIATED", tier: "og_throne", expires_at: "2026-08-02T01:00:00Z", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }]; },
    async loadTier(name) { calls.tier.push(name); return [{ name, is_active: true, stripe_price_id: name === "og_throne" ? "price_og" : "price_early" }]; },
    async loadPurchase(id) { calls.purchase.push(id); return []; },
    async recordPaid(args) { calls.paid.push(args); return "recorded"; },
    async recordTerminal(args) { calls.terminal.push(args); return args.p_event_kind === "SESSION_EXPIRED_UNPAID" ? "expired" : "canceled"; },
    ...overrides.db,
  };
  const input: WebhookInput = { enabled: "true", inboxEnabled: undefined, apiKey: "sk_test", webhookSecret: "whsec_dedicated", signature: "sig_test",
    async readRawBody() { calls.body++; return Buffer.from("RAW_BODY_NOT_JSON_PARSED"); },
    createProvider() { calls.provider++; return provider; }, createDatabase() { calls.database++; return db; }, ...overrides.input };
  return { calls, input, event, session, provider, db, run: () => paymentFirstWebhook(input) };
}

{
  const h = harness({ input: { enabled: undefined, signature: null, readRawBody: async () => { throw new Error("read"); }, createProvider: () => { throw new Error("provider"); }, createDatabase: () => { throw new Error("database"); } } });
  const result = await h.run(); equal(result.status, 503, "disabled is 503"); equal(result.body, { error: "Payment-first webhook is not active", code: "PAYMENT_FIRST_WEBHOOK_V2_DISABLED" }, "stable disabled response");
  equal(h.calls.body, 0, "disabled does not read body"); equal(h.calls.provider, 0, "disabled initializes no Stripe dependency"); equal(h.calls.database, 0, "disabled initializes no database");
}
for (const enabled of [undefined, "", "TRUE", " true", "false"]) equal((await harness({ input: { enabled } }).run()).status, 503, `gate rejects ${String(enabled)}`);
{
  const missing = harness({ input: { signature: null } }); equal((await missing.run()).status, 400, "missing signature is 400"); equal(missing.calls.body, 0, "missing signature does not read body");
  const invalid = harness({ provider: { constructEvent() { throw new Error("raw secret error"); }, retrieveSession: async () => { throw new Error("must not retrieve"); } } });
  const result = await invalid.run(); equal(result.status, 400, "invalid signature is 400"); equal(invalid.calls.database, 0, "invalid signature makes no database call"); equal(invalid.calls.session.length, 0, "invalid signature retrieves nothing");
  const valid = harness(); await valid.run(); equal([Buffer.from(valid.calls.construct[0][0] as Uint8Array).toString(), valid.calls.construct[0][1], valid.calls.construct[0][2]], ["RAW_BODY_NOT_JSON_PARSED", "sig_test", "whsec_dedicated"], "raw body and dedicated secret verify signature"); check(!JSON.stringify(result).includes("raw secret"), "verification error sanitized");
}
{
  const unsupported = harness({ event: { type: "payment_intent.payment_failed" } }); equal((await unsupported.run()).body, { status: "ignored", code: "NON_PAYMENT_V2_EVENT_IGNORED" }, "unsupported event ignored"); equal(unsupported.calls.database, 0, "unsupported event has zero DB calls");
  const legacy = harness({ event: { data: { object: { id: "cs_exact", metadata: {} } } } }); equal((await legacy.run()).body.status, "ignored", "legacy event ignored"); equal(legacy.calls.hold.length, 0, "legacy event reads no hold"); equal(legacy.calls.paid.length, 0, "legacy event calls no RPC");
  const wrong = harness({ event: { data: { object: { id: "cs_exact", metadata: { ...md, checkout_contract_version: "pfc-02" } } } } }); equal((await wrong.run()).body.status, "ignored", "wrong contract ignored");
  for (const [metadata, label] of [[{ ...md, payment_v2_hold_id: "bad" }, "invalid UUID"], [{ ...md, tier_name: "prime" }, "invalid tier"], [{ checkout_contract_version: PAYMENT_V2_WEBHOOK_CONTRACT }, "missing claimed metadata"]] as const)
    equal((await harness({ event: { data: { object: { id: "cs_exact", metadata: metadata as any } } } }).run()).status, 500, `${label} fails closed`);
}


{
  const raw = Buffer.from("{\"id\":\"evt_refund_created\"}");
  const calls: string[] = [];
  const inbox = harness({
    event: { id: "evt_refund_created", type: "refund.created", data: { object: { id: "re_exact" } } as any },
    input: { inboxEnabled: "true", async readRawBody() { calls.push("read"); return raw; }, createInboxDatabase: () => ({
      async receiveEvent(args) { calls.push(`receive:${args.p_lifecycle_phase}:${args.p_provider_object_type}:${args.p_raw_payload_sha256}`); return "RECEIVED" as const; },
      async transitionStatus(args) { calls.push(`transition:${args.p_expected_status}:${args.p_new_status}`); return "PENDING_PHASE" as const; },
    }) },
  });
  const result = await inbox.run();
  equal(result, { status: 200, body: { status: "pending", code: "PAYMENT_V2_EVENT_PENDING_PHASE" } }, "recognized lifecycle event is durably pending");
  equal(calls, ["read", `receive:PFC-07E-A2:refund:${createHash("sha256").update(raw).digest("hex")}`, "transition:RECEIVED:PENDING_PHASE"], "receive happens before lifecycle provider retrieval");
  equal(inbox.calls.session.length + inbox.calls.pi.length + inbox.calls.sub.length + inbox.calls.hold.length + inbox.calls.tier.length + inbox.calls.purchase.length, 0, "A1 lifecycle inbox path performs no provider or Payment V2 row lookup");
}
for (const inboxEnabled of [undefined, "", "TRUE", "1", "false"]) {
  const gated = harness({ event: { type: "refund.updated", data: { object: { id: "re_gate" } } as any }, input: { inboxEnabled } });
  equal((await gated.run()).body.code, "PAYMENT_V2_EVENT_INBOX_NOT_READY", `inbox gate rejects ${String(inboxEnabled)}`);
}
{
  const replay = harness({ event: { id: "evt_replay", type: "invoice.paid", data: { object: { id: "in_replay" } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async () => "PENDING_PHASE", transitionStatus: async () => { throw new Error("no transition"); } }) } });
  equal((await replay.run()).body, { status: "received", code: "PAYMENT_V2_EVENT_REPLAYED" }, "safe durable replay is acknowledged");
}
{
  const receivedReplay = harness({ event: { id: "evt_received", type: "customer.subscription.updated", data: { object: { id: "sub_received" } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async () => "RECEIVED", transitionStatus: async () => "PENDING_PHASE" }) } });
  equal((await receivedReplay.run()).body.code, "PAYMENT_V2_EVENT_PENDING_PHASE", "existing RECEIVED replay retries transition");
}
{
  const conflict = harness({ event: { id: "evt_conflict", type: "charge.dispute.created", data: { object: { id: "du_conflict" } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async () => { throw new Error("inbox_event_conflict"); }, transitionStatus: async () => "PENDING_PHASE" }) } });
  equal((await conflict.run()).body.code, "PAYMENT_V2_EVENT_INBOX_CONFLICT", "immutable inbox conflict is retryable 503 conflict");
}
{
  const failure = harness({ event: { id: "evt_failure", type: "refund.failed", data: { object: { id: "re_failure" } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async () => { throw new Error("db down"); }, transitionStatus: async () => "PENDING_PHASE" }) } });
  equal((await failure.run()).body.code, "PAYMENT_V2_EVENT_INBOX_UNAVAILABLE", "receive failure is unavailable");
}
{
  const transitionFailure = harness({ event: { id: "evt_transition_failure", type: "customer.subscription.deleted", data: { object: { id: "sub_failure" } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async () => "RECEIVED", transitionStatus: async () => { throw new Error("db down"); } }) } });
  equal((await transitionFailure.run()).body.code, "PAYMENT_V2_EVENT_INBOX_UNAVAILABLE", "transition failure is unavailable and durable row remains RECEIVED");
}
for (const [type, phase, object] of [["refund.created","PFC-07E-A2","refund"],["refund.updated","PFC-07E-A2","refund"],["refund.failed","PFC-07E-A2","refund"],["customer.subscription.updated","PFC-07E-A3","subscription"],["customer.subscription.deleted","PFC-07E-A3","subscription"],["invoice.payment_failed","PFC-07E-A3","invoice"],["invoice.paid","PFC-07E-A3","invoice"],["charge.dispute.created","PFC-07E-B","dispute"],["charge.dispute.closed","PFC-07E-B","dispute"]] as const) {
  let observed: any = null;
  const h = harness({ event: { id: `evt_${type.replace(/[^a-z]/g,"_")}`, type, data: { object: { id: `obj_${type.replace(/[^a-z]/g,"_")}` } } as any }, input: { inboxEnabled: "true", createInboxDatabase: () => ({ receiveEvent: async (args) => { observed = args; return "RECEIVED"; }, transitionStatus: async () => "PENDING_PHASE" }) } });
  equal((await h.run()).status, 200, `${type} accepted for durable receipt`);
  equal([observed.p_lifecycle_phase, observed.p_provider_object_type], [phase, object], `${type} maps to exact phase and object`);
}

const failures: Array<[string, Partial<PaymentV2Database>, Partial<StripeSession>]> = [
  ["missing hold", { loadHold: async () => [] }, {}], ["duplicate hold", { loadHold: async () => [await harness().db.loadHold(holdId)[0] as any, await harness().db.loadHold(holdId)[0] as any] }, {}],
  ["tier mismatch", { loadHold: async () => [{ ...(await harness().db.loadHold(holdId))[0], tier: "early_bird" }] }, {}],
  ["Session mismatch", { loadHold: async () => [{ ...(await harness().db.loadHold(holdId))[0], stripe_checkout_session_id: "cs_wrong" }] }, {}],
  ["hash malformed", { loadHold: async () => [{ ...(await harness().db.loadHold(holdId))[0], purchaser_credential_hash: new Uint8Array(31) }] }, {}],
  ["hold state", { loadHold: async () => [{ ...(await harness().db.loadHold(holdId))[0], state: "HELD" }] }, {}],
  ["missing tier", { loadTier: async () => [] }, {}], ["duplicate tier", { loadTier: async () => [{ name: "og_throne", is_active: true, stripe_price_id: "a" }, { name: "og_throne", is_active: true, stripe_price_id: "b" }] }, {}],
  ["inactive tier", { loadTier: async () => [{ name: "og_throne", is_active: false, stripe_price_id: "price_og" }] }, {}], ["blank Price", { loadTier: async () => [{ name: "og_throne", is_active: true, stripe_price_id: " " }] }, {}],
  ["provider Price", {}, { line_items: { data: [{ quantity: 1, price: { id: "price_evil", unit_amount: 2500, currency: "usd" } }] } }],
];
for (const [label, db, session] of failures) equal((await harness({ db, session }).run()).status, 500, `${label} fails closed`);

{
  const h = harness(); const result = await h.run(); equal(result.body.status, "received", "paid OG completed recorded"); equal(h.calls.session, ["cs_exact"], "exact Session retrieved"); equal(h.calls.pi, ["pi_exact"], "exact PaymentIntent retrieved");
  const args = h.calls.paid[0]; equal(args.p_hold_id, holdId, "exact hold RPC argument"); equal(args.p_purchaser_hash, hash, "stored hash RPC argument"); equal(args.p_session_id, "cs_exact", "exact Session RPC argument"); equal(args.p_customer_id, "cus_exact", "exact Customer RPC argument"); equal(args.p_price_id, "price_og", "database Price RPC argument"); equal(args.p_payment_intent_id, "pi_exact", "exact PI RPC argument"); equal(args.p_subscription_id, null, "OG null subscription"); equal(args.p_provider_event_id, "evt_exact", "exact event RPC argument"); equal(args.p_provider_confirmed_at, "2026-08-02T00:00:00.000Z", "event timestamp RPC argument"); equal(Buffer.from(args.p_purchaser_hash as Uint8Array).length, 32, "only 32-byte hash reaches RPC");
  const async = harness({ event: { type: "checkout.session.async_payment_succeeded" } }); equal((await async.run()).body.status, "received", "OG async success recorded");
  for (const [session, label] of [[{ mode: "subscription" }, "mode"], [{ status: "open" }, "status"], [{ customer: null }, "Customer"], [{ payment_intent: null }, "PI"], [{ subscription: "sub_bad" }, "subscription"], [{ line_items: { data: [] } }, "one item"], [{ line_items: { data: [{ quantity: 2, price: { id: "price_og", unit_amount: 2500, currency: "usd" } }] } }, "quantity" ]] as const)
    equal((await harness({ session: session as any }).run()).status, 500, `OG rejects ${label}`);
  for (const [pi, label] of [[{ status: "processing" }, "PI status"], [{ customer: "cus_wrong" }, "PI customer"], [{ amount: 1 }, "amount"], [{ currency: "eur" }, "currency"]] as const)
    equal((await harness({ provider: { retrievePaymentIntent: async () => ({ id: "pi_exact", status: "succeeded", customer: "cus_exact", amount: 2500, currency: "usd", ...pi }) } }).run()).status, 500, `OG rejects ${label}`);
  const pending = harness({ session: { payment_status: "unpaid" } }); equal((await pending.run()).body.status, "pending", "completed unpaid is pending"); equal(pending.calls.paid.length, 0, "pending calls no paid RPC");
}

function early(overrides: Parameters<typeof harness>[0] = {}) { return harness({ event: { ...overrides.event, data: overrides.event?.data || { object: { id: "cs_exact", metadata: { ...md, tier_name: "early_bird" } } } }, session: { mode: "subscription", payment_intent: null, subscription: "sub_exact", amount_total: 900, metadata: { ...md, tier_name: "early_bird" }, line_items: { data: [{ quantity: 1, amount_total: 900, price: { id: "price_early", unit_amount: 900, currency: "usd" } }] }, ...overrides.session }, db: { async loadHold() { return [{ id: holdId, state: "SESSION_ASSOCIATED", tier: "early_bird", expires_at: "x", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }]; }, ...overrides.db }, provider: overrides.provider, input: overrides.input }); }
{
  const h = early(); equal((await h.run()).body.status, "received", "Early Bird completed recorded"); equal(h.calls.sub, ["sub_exact"], "exact Subscription retrieved"); equal(h.calls.paid[0].p_payment_intent_id, null, "Early Bird null PI"); equal(h.calls.paid[0].p_subscription_id, "sub_exact", "Early Bird exact subscription");
  equal((await early({ event: { type: "checkout.session.async_payment_succeeded" } }).run()).body.status, "received", "Early Bird async recorded");
  const pending = early({ session: { payment_status: "unpaid" } }); equal((await pending.run()).body.status, "pending", "Early Bird pending"); equal(pending.calls.paid.length, 0, "Early Bird pending no RPC");
  for (const [session, label] of [[{ mode: "payment" }, "mode"], [{ status: "open" }, "status"], [{ customer: null }, "Customer"], [{ subscription: null }, "Subscription"], [{ payment_intent: "pi_bad" }, "PI identity"]] as const) equal((await early({ session: session as any }).run()).status, 500, `Early Bird rejects ${label}`);
  for (const [sub, label] of [[{ customer: "wrong" }, "customer"], [{ status: "canceled" }, "status"], [{ items: { data: [] } }, "item count"], [{ items: { data: [{ quantity: 2, price: { id: "price_early" } }] } }, "quantity"], [{ items: { data: [{ quantity: 1, price: { id: "wrong" } }] } }, "Price"], [{ latest_invoice: { paid: false, status: "open" } }, "invoice"]] as const)
    equal((await early({ provider: { retrieveSubscription: async () => ({ id: "sub_exact", customer: "cus_exact", status: "active", items: { data: [{ quantity: 1, price: { id: "price_early" } }] }, latest_invoice: { paid: true }, ...sub }) } }).run()).status, 500, `Early Bird rejects ${label}`);
}

for (const result of ["recorded", "already_recorded"]) equal((await harness({ db: { recordPaid: async () => result } }).run()).body.status, "received", `${result} accepted`);
equal((await harness({ db: { recordPaid: async () => "unexpected" } }).run()).status, 500, "unexpected paid RPC result fails");
{
  let state = "SESSION_ASSOCIATED"; let purchaseCount = 0; let paidCalls = 0;
  const replay = harness({ db: {
    loadHold: async () => [{ id: holdId, state, tier: "og_throne", expires_at: "x", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }],
    loadPurchase: async () => purchaseCount ? [{ hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null }] : [],
    async recordPaid() { paidCalls++; if (state === "SESSION_ASSOCIATED") { state = "PAID_UNCLAIMED"; purchaseCount = 1; return "recorded"; } return "already_recorded"; },
  } });
  equal((await replay.run()).body.status, "received", "first paid event records"); equal(state, "PAID_UNCLAIMED", "database models paid hold transition"); equal(purchaseCount, 1, "database models one stored purchase");
  equal((await replay.run()).body.status, "received", "same paid event replays after state transition"); equal(paidCalls, 1, "exact purchase replay performs no second paid RPC"); equal(purchaseCount, 1, "replay creates no duplicate purchase");
  for (const advanced of ["CLAIMED", "REFUNDED", "REVOKED"]) {
    state = advanced; equal((await replay.run()).body.status, "received", `exact paid replay accepted from ${advanced}`);
  }
}
{
  let state = "SESSION_ASSOCIATED"; let stored = false; let paidCalls = 0; let evidenceCount = 0;
  const purchase = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  const outOfOrder = harness({ event: { type: "checkout.session.async_payment_succeeded", id: "evt_async" }, db: {
    loadHold: async () => [{ id: holdId, state, tier: "og_throne", expires_at: "x", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }],
    loadPurchase: async () => stored ? [purchase] : [],
    async recordPaid() { paidCalls++; stored = true; state = "PAID_UNCLAIMED"; evidenceCount++; return "recorded"; },
  } });
  equal((await outOfOrder.run()).body.status, "received", "async success delivered first records purchase"); equal(state, "PAID_UNCLAIMED", "async success advances hold");
  outOfOrder.event.type = "checkout.session.completed"; outOfOrder.event.id = "evt_completed_later";
  equal((await outOfOrder.run()).body.status, "received", "later completed event acknowledges exact purchase"); equal(paidCalls, 1, "later distinct paid event makes no additional RPC"); equal(evidenceCount, 1, "later event creates no duplicate evidence");
  outOfOrder.event.id = "evt_async"; equal((await outOfOrder.run()).body.status, "received", "exact same paid event replay acknowledged by purchase read"); equal(paidCalls, 1, "exact replay has no duplicate mutation");
}
{
  let state = "SESSION_ASSOCIATED"; let stored = false; let paidCalls = 0;
  const purchase = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  const delayed = harness({ session: { payment_status: "unpaid" }, db: {
    loadHold: async () => [{ id: holdId, state, tier: "og_throne", expires_at: "x", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }], loadPurchase: async () => stored ? [purchase] : [],
    async recordPaid() { paidCalls++; stored = true; state = "PAID_UNCLAIMED"; return "recorded"; },
  } });
  equal((await delayed.run()).body.status, "pending", "completed event is initially pending");
  delayed.session.payment_status = "paid"; delayed.event.type = "checkout.session.async_payment_succeeded"; delayed.event.id = "evt_async_after_pending";
  equal((await delayed.run()).body.status, "received", "later async success records pending Session");
  delayed.event.type = "checkout.session.completed"; delayed.event.id = "evt_completed_earlier";
  equal((await delayed.run()).body.status, "received", "earlier completed replay acknowledges stored purchase"); equal(paidCalls, 1, "pending sequence makes only one paid RPC");
}
{
  const base = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  for (const [change, label] of [[{ stripe_customer_id: "cus_wrong" }, "Customer"], [{ stripe_price_id: "price_wrong" }, "Price"], [{ stripe_payment_intent_id: "pi_wrong" }, "PaymentIntent"], [{ stripe_subscription_id: "sub_wrong" }, "Subscription"], [{ stripe_checkout_session_id: "cs_wrong" }, "Session"], [{ tier: "early_bird" }, "tier"]] as const) {
    const mismatch = harness({ db: { loadPurchase: async () => [{ ...base, ...change }] } }); equal((await mismatch.run()).status, 500, `existing purchase ${label} mismatch fails closed`); equal(mismatch.calls.paid.length, 0, `${label} mismatch makes no paid RPC`);
  }
}
{
  const exact = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  let reads = 0; let rpcCalls = 0;
  const race = harness({ db: { loadPurchase: async () => ++reads === 1 ? [] : [exact], async recordPaid() { rpcCalls++; throw new Error("paid_purchase_conflict"); } } });
  equal((await race.run()).body.status, "received", "concurrent paid recording reconciles exact purchase"); equal(reads, 2, "paid race re-reads purchase once"); equal(rpcCalls, 1, "paid race does not retry RPC");
  for (const rows of [[], [{ ...exact, stripe_customer_id: "wrong" }]]) {
    let attempts = 0; const conflict = harness({ db: { loadPurchase: async () => ++attempts === 1 ? [] : rows, async recordPaid() { throw new Error("paid_purchase_conflict"); } } });
    equal((await conflict.run()).status, 500, "concurrent conflict without exact purchase fails closed");
  }
}
{
  const expired = harness({ event: { type: "checkout.session.expired" }, session: { status: "expired", payment_status: "unpaid", payment_intent: null } }); equal((await expired.run()).body.status, "received", "expired recorded");
  const a = expired.calls.terminal[0]; equal(a.p_event_kind, "SESSION_EXPIRED_UNPAID", "expiration kind"); equal(a.p_hold_id, holdId, "terminal hold"); equal(a.p_session_id, "cs_exact", "terminal Session"); equal(a.p_provider_event_id, "evt_exact", "terminal event"); equal(a.p_provider_occurred_at, "2026-08-02T00:00:00.000Z", "terminal timestamp");
  const canceled = harness({ event: { type: "checkout.session.async_payment_failed" }, session: { payment_status: "unpaid", payment_intent: null } }); equal((await canceled.run()).body.status, "received", "failure recorded"); equal(canceled.calls.terminal[0].p_event_kind, "PAYMENT_CANCELED_UNPAID", "cancellation kind");
  for (const value of ["expired", "canceled", "already_recorded"]) equal((await harness({ event: { type: "checkout.session.async_payment_failed" }, session: { payment_status: "unpaid", payment_intent: null }, db: { recordTerminal: async () => value } }).run()).body.status, "received", `terminal ${value} accepted`);
  const paid = harness({ event: { type: "checkout.session.expired" } }); equal((await paid.run()).status, 500, "terminal event observing paid without purchase fails closed"); equal(paid.calls.terminal.length, 0, "paid terminal event never terminalized"); equal(paid.calls.paid.length, 0, "terminal event never becomes payment confirmation evidence");
  const existing = harness({ event: { type: "checkout.session.async_payment_failed" }, session: { payment_status: "unpaid", payment_intent: null }, db: { loadPurchase: async () => [{ hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null }] } }); equal((await existing.run()).status, 500, "existing paid purchase prevents terminal mutation"); equal(existing.calls.terminal.length, 0, "existing purchase no terminal RPC");
}

for (const [type, finalState, firstResult] of [["checkout.session.expired", "EXPIRED_UNPAID", "expired"], ["checkout.session.async_payment_failed", "CANCELED_UNPAID", "canceled"]] as const) {
  let state = "SESSION_ASSOCIATED"; let terminalCalls = 0;
  const replay = harness({ event: { type }, session: { status: type === "checkout.session.expired" ? "expired" : "complete", payment_status: "unpaid", payment_intent: null }, db: {
    loadHold: async () => [{ id: holdId, state, tier: "og_throne", expires_at: "x", stripe_checkout_session_id: "cs_exact", purchaser_credential_hash: hash }],
    async recordTerminal() { terminalCalls++; if (state === "SESSION_ASSOCIATED") { state = finalState; return firstResult; } return "already_recorded"; },
  } });
  equal((await replay.run()).body.status, "received", `${firstResult} first delivery accepted`); equal(state, finalState, `${firstResult} models hold transition`);
  equal((await replay.run()).body.status, "received", `${firstResult} exact replay accepted`); equal(terminalCalls, 2, `${firstResult} replay reaches terminal RPC`);
}

{
  const purchase = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  const exact = harness({ event: { type: "checkout.session.expired" }, db: { loadPurchase: async () => [purchase] } });
  equal((await exact.run()).body.status, "received", "exact paid purchase acknowledges terminal delivery"); equal(exact.calls.pi, ["pi_exact"], "paid-before-terminal verifies PaymentIntent"); equal(exact.calls.terminal.length, 0, "paid-before-terminal calls no terminal RPC"); equal(exact.calls.paid.length, 0, "paid-before-terminal calls no paid RPC");
  const missing = harness({ event: { type: "checkout.session.expired" }, session: { customer: null }, db: { loadPurchase: async () => [purchase] } }); equal((await missing.run()).status, 500, "missing current Customer fails reconciliation");
  const mismatch = harness({ event: { type: "checkout.session.expired" }, session: { customer: "cus_other" }, provider: { retrievePaymentIntent: async () => ({ id: "pi_exact", status: "succeeded", customer: "cus_other", amount: 2500, currency: "usd" }) }, db: { loadPurchase: async () => [purchase] } }); equal((await mismatch.run()).status, 500, "mismatched stored Customer fails reconciliation");
}
{
  const unpaid = { ...harness().session, payment_status: "unpaid", payment_intent: null };
  const paid = { ...harness().session };
  const purchase = { hold_id: holdId, tier: "og_throne", stripe_checkout_session_id: "cs_exact", stripe_customer_id: "cus_exact", stripe_price_id: "price_og", stripe_payment_intent_id: "pi_exact", stripe_subscription_id: null };
  let sessionReads = 0; let purchaseReads = 0; let terminalCalls = 0;
  const race = harness({ event: { type: "checkout.session.async_payment_failed" }, provider: { retrieveSession: async () => ++sessionReads === 1 ? unpaid : paid }, db: {
    loadPurchase: async () => ++purchaseReads === 1 ? [] : [purchase], async recordTerminal() { terminalCalls++; throw new Error("paid_purchase_exists"); },
  } });
  equal((await race.run()).body.status, "received", "terminal paid_purchase_exists race reconciles exact paid purchase"); equal(sessionReads, 2, "terminal race re-retrieves current Session"); equal(purchaseReads, 2, "terminal race re-reads purchase once"); equal(terminalCalls, 1, "terminal race does not retry terminal RPC"); equal(race.calls.paid.length, 0, "terminal race calls no paid RPC"); equal(race.calls.pi, ["pi_exact"], "terminal race verifies current PaymentIntent evidence");
}

{
  const route = readFileSync("app/api/webhook/payment-v2/route.ts", "utf8"); const service = readFileSync("lib/payment-v2/webhookService.ts", "utf8"); const combined = route + service;
  check(route.includes('runtime = "nodejs"') && route.includes('dynamic = "force-dynamic"'), "route runtime contract"); check(!route.includes("export async function GET"), "no GET handler"); check(route.includes("STRIPE_PAYMENT_V2_WEBHOOK_SECRET") && !route.includes("STRIPE_WEBHOOK_SECRET"), "dedicated secret only");
  for (const forbidden of ["payment_v2_claim", "payment_v2_expire_unpaid", "user_subscriptions", "profiles", "payment_v2_allocations", "grantOg", "commission", "app/api/webhook/route"]) check(!combined.includes(forbidden), `${forbidden} prohibited`);
  check(!/\.from\("payment_v2_[^"]+"\)\.(insert|update|delete)/.test(route), "no direct V2 mutations"); check(!combined.includes("console."), "payload, signature, hash and credentials are not logged");
  equal(harness().calls.session.length, 0, "test harness starts with zero provider network calls");
}
console.log(`PFC-04 payment-first Webhook V2 tests passed (${assertions} assertions; no external network calls)`);
