import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { classifyPaymentV2LifecycleEvent } from "../../../lib/payment-v2/eventClassification"
import { paymentFirstWebhook, type PaymentV2Database, type PaymentV2Provider, type StripeEvent } from "../../../lib/payment-v2/webhookService"
import type { InboxStatus } from "../../../lib/payment-v2/eventInboxService"

const source = { source_type: "OG_INITIAL", purchase_id: "10000000-0000-4000-8000-000000000001" }
function harness(kind: "refund" | "dispute", options: { rpcResult?: string; rpcError?: string; sources?: number; status?: string } = {}) {
  let state: InboxStatus = "RECEIVED", retrieved = 0
  const applied: Record<string, unknown>[] = []
  const event: StripeEvent = { id: `evt_${kind}`, type: kind === "refund" ? "refund.updated" : "charge.dispute.updated", created: 1786000100, data: { object: { id: kind === "refund" ? "re_test" : "du_test" } } }
  const refund = { id: "re_test", charge: "ch_test", payment_intent: "pi_test", amount: 500, currency: "usd", status: options.status || "pending", reason: null, failure_reason: null, created: 1786000000 }
  const dispute = { id: "du_test", charge: "ch_test", payment_intent: "pi_test", amount: 500, currency: "usd", status: options.status || "needs_response", reason: "fraudulent", evidence_details: { due_by: 1787000000 }, created: 1786000000 }
  const provider: PaymentV2Provider = {
    constructEvent: () => event, retrieveSession: async () => { throw new Error("unused") }, retrievePaymentIntent: async () => ({ id: "pi_test", status: "succeeded", customer: "cus_test", amount: 500, currency: "usd", metadata: {} }), retrieveSubscription: async () => { throw new Error("unused") },
    retrieveRefund: async () => { retrieved++; return refund }, retrieveDispute: async () => { retrieved++; return dispute }, retrieveCharge: async () => ({ id: "ch_test", payment_intent: "pi_test", metadata: {} }),
  }
  const db = { loadHold: async () => [], loadTier: async () => [], loadPurchase: async () => [], recordPaid: async () => "", recordTerminal: async () => "",
    resolveFinancialSource: async () => Array.from({ length: options.sources ?? 1 }, () => source),
    applyRefund: async (args: Record<string, unknown>) => { applied.push(args); if (options.rpcError) throw new Error(options.rpcError); return options.rpcResult || "applied" },
    applyDispute: async (args: Record<string, unknown>) => { applied.push(args); if (options.rpcError) throw new Error(options.rpcError); return options.rpcResult || "applied" },
  } satisfies PaymentV2Database
  return { get state() { return state }, get retrieved() { return retrieved }, applied, run: () => paymentFirstWebhook({ enabled: "true", inboxEnabled: "true", apiKey: "sk_test", webhookSecret: "whsec_test", signature: "sig", readRawBody: async () => Buffer.from("signed"), createProvider: () => provider, createDatabase: () => db, createInboxDatabase: () => ({ receiveEvent: async () => state, transitionStatus: async (args) => state = args.p_new_status }) }) }
}

test("Phase 12 classifications are finite", () => { for (const type of ["refund.created", "refund.updated", "refund.failed"]) assert.equal(classifyPaymentV2LifecycleEvent(type)?.lifecyclePhase, "PFC-07E-A2"); for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) assert.equal(classifyPaymentV2LifecycleEvent(type)?.lifecyclePhase, "PFC-07E-B") })
test("A2 retrieves authoritative refund and applies its snapshot", async () => { const h = harness("refund", { status: "requires_action" }); const response = await h.run(); assert.equal(response.status, 200); assert.equal(h.state, "PROCESSED"); assert.equal(h.retrieved, 1); assert.equal(h.applied[0].p_status, "requires_action") })
test("B retrieves authoritative dispute and applies evidence due", async () => { const h = harness("dispute", { status: "under_review" }); await h.run(); assert.equal(h.state, "PROCESSED"); assert.equal(h.retrieved, 1); assert.equal(h.applied[0].p_status, "under_review"); assert.equal(h.applied[0].p_evidence_due_at, new Date(1787000000 * 1000).toISOString()) })
test("known non-V2 unresolved source terminates ignored", async () => { const h = harness("refund", { sources: 0 }); await h.run(); assert.equal(h.state, "IGNORED_NON_V2") })
test("ambiguous source is terminal", async () => { const h = harness("dispute", { sources: 2 }); await h.run(); assert.equal(h.state, "FAILED_TERMINAL"); assert.equal(h.applied.length, 0) })
test("stable Phase 12 database invariant errors are terminal", async () => { for (const error of ["source_ambiguous", "financial_identity_conflict", "source_currency_mismatch", "source_payment_intent_mismatch", "refund_total_exceeds_gross", "dispute_amount_exceeds_gross", "recurring_purchase_mismatch"]) { const h = harness("refund", { rpcError: error }); const response = await h.run(); assert.equal(response.status, 200); assert.equal(h.state, "FAILED_TERMINAL", error) } })
test("temporary database failure remains retryable", async () => { const h = harness("refund", { rpcError: "connection unavailable" }); const response = await h.run(); assert.equal(response.status, 503); assert.equal(h.state, "PENDING_RETRY") })
test("database-recorded identity conflict is terminal", async () => { const h = harness("refund", { rpcResult: "financial_identity_conflict" }); await h.run(); assert.equal(h.state, "FAILED_TERMINAL") })
test("migration preserves frozen payout dispatch and exact policy", async () => { const sql = await readFile("supabase/migrations/20260906200000_phase12_billing_refunds_disputes.sql", "utf8"); for (const token of ["if x.execution_status='dispatching'", "r.reconciliation_status<>'RECONCILED'", "r.commission_amount_cents is distinct from l.commission_amount_cents", "h.stripe_connect_destination", "r.stripe_source_charge_id", "invalid_dispatch_payload", "payment_v2_source_charge_blocks_affiliate_payout", "AUTHORITATIVE_FULL_REFUND", "AUTHORITATIVE_NON_LOSS", "FINANCIAL_IDENTITY_CONFLICT", "FORCE ROW LEVEL SECURITY"]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) })
test("creator entitlement remains fail closed", async () => { const checker = await readFile("lib/subscription-checker.ts", "utf8"); assert.doesNotMatch(checker, /\[([^\]]*['\"]refunded['\"]|[^\]]*['\"]revoked['\"])[^\]]*\]/) })
