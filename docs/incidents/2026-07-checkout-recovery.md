# July 2026 Checkout Incident and Recovery

## Record status and evidence boundary

**Verified in Production.** This record captures the supplied recovery facts and repository artifacts through 2026-08-01. The affected work spans PRs #189 through #193; repository evidence does not prove one single root cause across that range, so this record must not claim one. Specific defects and attempted repairs appear in commit history, but a sequence of fixes is not proof of a unique underlying cause.

## Scope and intended goal

**Planned at incident start.** The intended goal was a payment-first flow in which a guest could reserve limited launch capacity, pay before creating/authenticating an account, and later claim the purchase and entitlement safely.

**Incident scope.** PRs #189–#193 changed or repaired parts of guest reservation, tier switching, PostgREST schema readiness, and the Checkout contract. The work crossed schema/RPCs, Checkout frontend/server logic, Stripe metadata/webhooks, authentication/claim behavior, entitlement behavior, and deployment state. It did not reach a trustworthy Production baseline.

The known-good rollback anchor was `8a52c720f33101781bb38a80a7ebe08bbb7fa72d`.

## Containment and application recovery

1. **Verified in Production:** Production traffic was manually rolled back in Vercel to the known-good anchor. This separated traffic containment from Git recovery.
2. **Verified in Production:** Recovery PR #194 restored the pre-incident application contract and added the forward cleanup migration. Its merge commit is `810d65893c1afedb97536155aca1107065a58e7f`.
3. **Verified in Production:** The recovered application was promoted and checked with safe smoke verification. Smoke verification did not invoke real Checkout, payment, subscription, entitlement, Connect onboarding, OAuth, or posting and must not be described as end-to-end payment proof.
4. **Verified in Production:** Local and remote recovery branches were cleaned up after the recovered commit was established. Branch cleanup was hygiene, not evidence about runtime behavior.

## Forward-only database cleanup

The repair is `supabase/migrations/20260731002700_remove_checkout_incident_objects.sql`.

**Verified in Production.** Applied migrations `20260729002100` through `20260730002600` were preserved as immutable migration history. Migration 02700 was applied exactly once, only after a final read-only audit and separate authorization.

Based on migration 02700, cleanup:

- unscheduled the `sirens_forge_checkout_guest_rate_limit_cleanup` cron responsibility;
- removed `checkout_guest_rate_limit_attempts`, `pay_first_purchases`, and `checkout_capacity_reservations`;
- removed guest acquire/bind/expire/switch, pay-first record/claim, guest-rate cleanup, authenticated capacity acquire/associate/release/expire, and OG fulfillment functions introduced by the incident migrations; and
- requested a PostgREST schema reload after cleanup.

The migration acquired an advisory lock and table locks and failed closed unless expected tables and an authorized time cutoff were present. It checked that `pay_first_purchases` was empty; reservations had no payment intent, Stripe subscription, fulfilled timestamp/status; and `user_subscriptions` contained no incident-contract entitlement. It also restricted the only tolerated reservation/rate-attempt state before dropping objects.

**Verified in Production.** Because those guards passed during the authorized single application, no paid purchase, subscription, entitlement, or fulfillment record was deleted by cleanup. This is a bounded statement about 02700, not a claim that the abandoned flow successfully processed a payment.

## Stripe Connect security follow-up

**Verified in Production.** PR #195 restored server-authentication protection for Stripe Connect after the application recovery. The current merge commit is `7522c54e83c02b0fff15b7ab57364f711cb1bf67`. The route now derives identity from the server session, requires one matching profile, scopes persistence to that identity, creates no privileged/provider client before authentication, and returns sanitized errors.

**Unknown / requires verification.** No live Stripe Connect onboarding was executed as part of the restoration; route protection and tests are not onboarding proof.

## Root-cause statement

**Unknown / requires verification.** The repository proves a risky multi-layer change sequence and individual repair attempts, not one conclusive root cause. A later retrospective may identify contributing causes only when tied to commit, log, deployment, database, or provider evidence. It must preserve conflicting evidence and avoid hindsight speculation.

## Lessons learned

- Do not design directly in Production.
- Do not combine schema, frontend, provider, and entitlement changes without staged, reviewed contracts.
- Do not treat build or deployment success as end-to-end payment proof.
- Do not invoke real Checkout during incident recovery unless separately authorized.
- Require read-only audits before destructive cleanup.
- Preserve applied migrations and use forward-only repair migrations.
- Require explicit evidence that custom-domain aliases promoted to the intended deployment.
- Protect every privileged route with server-authenticated identity and resource-level authorization.
- Keep provider errors sanitized; log only safe operational detail and never secrets/customer data.
- Require idempotency and reconciliation design before implementing payment-first behavior.

## Mandatory safeguards for future Checkout work

1. Establish a read-only baseline: exact Git/deployment SHA, aliases, remote schema and migration ledger, RLS, cron, tier/capacity invariants, Stripe object contract, webhook endpoints/events, and existing entitlement state.
2. Write the state machine first: guest identity/token custody, reservation ownership and expiry, session association, payment evidence, account claim, single entitlement grant, failure/retry paths, refunds/cancellations, and operator reconciliation.
3. Define trust boundaries. Stripe webhook evidence—not a browser redirect—drives paid state. Server-authenticated identity and one-time, hashed, expiring claim material bind a purchase to an account.
4. Specify idempotency and concurrency for session creation, webhook replay/out-of-order delivery, reservation switching/expiry, claims, and entitlement writes. Define database uniqueness and locking explicitly.
5. Stage schema, server/RPC, webhook, frontend, and activation separately. Keep compatibility until each stage is deployed and verified; use feature gates that fail closed.
6. Use forward-only migrations with audited preconditions, preservation checks, safe aborts, observability, and an authorized repair path. Never edit applied migrations.
7. Test pure contracts, route authorization, SQL integration/concurrency, webhook replay/order, provider failure sanitization, and reconciliation before any live action.
8. Gate separately: merge, migration, environment, deployment, alias promotion, safe smoke, real Checkout, and Production activation. No gate implies the next.
9. During recovery, prefer safe GET/HEAD and read-only inspection. A real payment, subscription, entitlement, Connect, OAuth, or destructive action requires explicit authorization.
10. Record exact evidence and remaining unknowns. A future payment-first flow is not complete until legitimate authorized end-to-end proof and reconciliation succeed.
