import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path: string) => readFileSync(path, "utf8");

test("authoritative Payment V2 flow records failed invoice identity and recovery", () => {
  const service = read("lib/payment-v2/webhookService.ts");
  const route = read("app/api/webhook/payment-v2/route.ts");
  assert.match(service, /failedInvoice\.billing_reason !== "subscription_cycle"/);
  assert.match(service, /p_invoice_id: failedInvoice\.id/);
  assert.match(service, /recordSubscriptionPaymentFailure/);
  assert.match(service, /recoverSubscriptionPaymentDelinquency/);
  assert.match(service, /invoiceSatisfied/);
  assert.match(service, /\["past_due", "unpaid"\]\.includes\(subscription\.status\)/);
  assert.match(route, /payment_v2_record_subscription_payment_failure/);
  assert.match(route, /payment_v2_recover_subscription_payment_delinquency/);
});

test("central paid entitlement gate freezes open delinquency after deletion precedence", () => {
  const gate = read("lib/subscription-checker.ts");
  assert.match(gate, /subscription_payment_delinquencies/);
  assert.match(gate, /PAYMENT_DELINQUENT/);
  assert.match(gate, /\["active", "trialing", "past_due", "unpaid", "canceled"\]/);
  assert.ok(gate.indexOf("ACCOUNT_DELETION_PENDING") < gate.indexOf("subscription_payment_delinquencies"));
});

test("migration is private, invoice-idempotent, and separate from cancellation and purge execution", () => {
  const sql = read("supabase/migrations/20260905031500_phase7_subscription_payment_delinquency.sql");
  assert.match(sql, /unique \(stripe_subscription_id, provider_invoice_id\)/i);
  assert.match(sql, /unique \(stripe_subscription_id, billing_period_start, billing_period_end\)/i);
  assert.match(sql, /already_recorded_cycle/);
  assert.match(sql, /stale_failure_ignored/);
  assert.match(sql, /stale_recovery_ignored/);
  assert.match(sql, /recovery_invoice_id text/);
  assert.match(sql, /recovery_billing_period_start timestamptz/);
  assert.match(sql, /recovery_billing_period_end timestamptz/);
  assert.match(sql, /p_billing_period_start < d\.recovery_billing_period_end/);
  assert.match(sql, /retention_until = retention_started_at \+ interval '60 days'/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all .* anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /insert into public\.subscription_cancellation_retentions/i);
  assert.doesNotMatch(sql, /purge_job|delete from|notification.*sent/i);
  assert.match(sql, /buy\.tier = 'early_bird'/);
});

test("affiliate payout reconciliation cannot mutate delinquency", () => {
  const payout = read("app/api/admin/affiliate-payouts/execute/route.ts");
  assert.match(payout, /reconcilePaidInvoices/);
  assert.doesNotMatch(payout, /recoverSubscriptionPaymentDelinquency|payment_v2_recover_subscription_payment_delinquency/);
});

test("billing copy distinguishes first miss from countdown and states the Phase 7 limit", () => {
  const billing = read("app/billing/page.tsx");
  assert.match(billing, /Normal creator tools are temporarily frozen/);
  assert.match(billing, /60-day retained-data countdown/);
  assert.match(billing, /irreversible purge execution is not part of this phase/);
});
