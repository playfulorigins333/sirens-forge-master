# Phase 12 billing, Stripe, entitlements, refunds, and disputes closeout

## PHASE 12 PARTIALLY COMPLETE
Sirens Forge consumes authoritative Stripe refund and dispute snapshots; it never automatically creates a refund. Completed Stripe refund events are consumed. A full OG refund ends lifetime entitlement as refunded, while a full lost OG dispute revokes it. A partial OG refund or dispute loss does not invent partial-access semantics. Open disputes do not revoke access. Early Bird entitlement remains governed exclusively by the existing A3 subscription lifecycle.

Financial adjustments block affiliate payout both during selection and immediately before dispatch. Undispatched full OG commissions are voided. Partial adjustments and money already dispatching or paid create durable fail-closed finance-review evidence; already-paid affiliate funds are **not** clawed back automatically.

The protected `/admin/billing` surface is read-only, capability controlled, fresh-TOTP protected, paginated, and audited with minimized facts.

## PRODUCTION MIGRATION REQUIRED
`20260906200000_phase12_billing_refunds_disputes.sql` must be reviewed and applied separately under explicit Production authorization. It was not applied by this source implementation.

## PRODUCTION VERIFICATION REQUIRED
After authorized migration and deployment, independently verify grants/RLS, custom-domain routing, webhook inbox transitions, entitlement denial, payout exclusion, and dispatch race closure. A build or Production-target deployment alone is not evidence that Production serves it.

## REAL STRIPE / PROVIDER VERIFICATION DEFERRED
No live Stripe call, payment, Checkout, refund creation, subscription mutation, dispute response, evidence submission, dispute closure, transfer, or transfer reversal was performed. Stripe Dashboard remains the human dispute-response surface.

## FAIL-CLOSED FINANCE REVIEW CONDITIONS
Partial refunds, partial dispute losses, Early Bird dispute losses, identity conflicts, and adjustments discovered after affiliate dispatch/payment remain blocked for PAY/finance review. Phase 12 intentionally provides no arbitrary money-adjustment or review-resolution endpoint.
