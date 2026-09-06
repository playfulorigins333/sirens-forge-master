# Phase 9 — Transactional notification delivery closeout

Phase 9 consumes (and does not redefine) Phase 7/8 lifecycle truth. It adds transactional account email for: export ready; deletion requested, reactivated, and completed; and day 0, 30, 45, and 55 notices for both subscription-cancellation and payment-delinquency retention. No marketing, SMS, push, preference center, admin system, billing transition, publishing, or compute/provider work is included.

## Architecture and delivery safety

`20260906040000_phase9_transactional_notifications.sql` introduces a FORCE-RLS outbox keyed uniquely by source family, source row, and milestone. A bounded materializer excludes existing identities before ordering and limiting, so repeated runs drain a backlog without starving newer work; `ON CONFLICT` remains the concurrency guard. A `FOR UPDATE SKIP LOCKED` claim gives each batch a ten-minute lease and increments its bounded attempt count. Source state and ownership are revalidated in the claim transaction; superseded/recovered/stale rows are terminally suppressed. Delivered rows cannot be reclaimed. Retryable failures use deterministic exponential backoff and an eight-attempt ceiling.

Immediately before transport, a service-role-only RPC durably marks that provider delivery has started. An expired lease without that marker is safely requeued; an expired lease after provider attempt start is deliberately terminalized as uncertain. This prevents unattempted rows later in an interrupted batch from being lost without blindly repeating an uncertain send. Resend receives the stable outbox ID as its idempotency key; only a SHA-256 digest of a successful provider message ID is retained. Explicit SDK `statusCode`/`name` classification retries 408, 425, 429, 5xx, and known transient errors; definite 4xx rejection is safely suppressed as `provider_permanent`; thrown network outcomes remain uncertain.

The server resolves the current email from Supabase Auth by the outbox's authoritative `auth_user_id`. No route accepts an email, user ID, or source ID. Invalid/missing recipients fail closed, while transient Auth-admin errors retry without abandoning the rest of the batch. Templates are centralized, typed, plain-text plus escaped HTML, use durable lifecycle dates, contain no private creator content or internal IDs, avoid unconditional destruction promises, and default links to `https://www.sirensforge.vip` unless `NEXT_PUBLIC_SITE_URL` overrides it.

The outbox intentionally stores the authoritative owner UUID without a foreign key to `auth.users`: durable notification evidence must not block the existing account-deletion authority from removing an Auth row. Delivery still re-resolves that exact UUID through Auth and suppresses if the user no longer exists; it never substitutes another recipient.

## Scheduler and configuration

Vercel invokes `GET /api/internal/notifications/phase9/run` hourly at minute 23 (`23 * * * *`). The route requires the established `CRON_SECRET` (or platform-compatible `VERCEL_CRON_SECRET`) scheduler authentication. It returns only bounded counts and finite error codes. Operational logs contain event, notification kind, outcome, and attempt only.

Live delivery is exact-default-off. It occurs only when all prerequisites are separately authorized and configured:

- `PHASE9_NOTIFICATIONS_ENABLED=true` (lowercase exact match)
- `RESEND_API_KEY`
- `PHASE9_NOTIFICATION_FROM_EMAIL` (an approved verified sender)
- `NEXT_PUBLIC_SITE_URL` (existing canonical official-site URL used for account links)
- `CRON_SECRET` or existing `VERCEL_CRON_SECRET`
- the migration applied through the separately authorized Production migration process
- Resend sender-domain/DNS configuration independently verified

Merging or deploying source without the gate sends nothing. Phase 9 development tests inject transports and never call Resend.

## Security, tests, and containment

The outbox has RLS and FORCE RLS. `PUBLIC`, `anon`, and `authenticated` have no table or function rights. `service_role` has execute only on the four bounded `SECURITY DEFINER` functions; it has no direct table grant. Functions pin `search_path`, validate limits/tokens/outcomes, and are owned by `postgres`.

Coverage includes source/security contracts, all twelve templates, default-off/config behavior, injected-transport success/retry/uncertain/invalid-recipient behavior, sanitized evidence/logs, actual PostgreSQL constraints/materialization/revalidation/claim/finalize/idempotency and role denial, scheduler source boundary, TypeScript, build, and Phase 7/8 regressions. CI uses disposable PostgreSQL 17.

Immediate containment is setting/removing `PHASE9_NOTIFICATIONS_ENABLED` so its exact value is not `true`; no rollback migration or lifecycle timestamp rewrite is needed. If delivery is later activated and an incident occurs, disable the gate first, preserve outbox evidence, and investigate before any forward-only corrective migration.

Phase 10 remains explicitly unstarted: Phase 9 adds no admin/support/security/2FA capability. Production migration, environment mutation, provider configuration, test email, activation, and deployment remain separate authorization gates.
