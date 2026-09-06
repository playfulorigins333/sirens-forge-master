# Phase 8I — Launch / Admin Hygiene

## Scope

Phase 8I closes launch-only administrative exposure and repository-governance hygiene without reopening completed billing, retention, compliance, publishing, or generation architecture.

Source baseline for this pass: frontend `main` at `a89812acbda411130ff763ffbcf9c9b6d1115711` after Phase 8H.

## Source closeout

### Legacy Autopost admin surface

`app/api/admin/autopost/**` is legacy diagnostic / proof / controlled-test machinery. It is not the authoritative Phase 1 publishing state machine. Creator Publishing Queue (CPQ) remains the launch authority for Fanvue.

Phase 8I therefore adds a launch-level fail-closed boundary in `proxy.ts`:

- every `/api/admin/autopost` route and descendant returns `404` with `Cache-Control: no-store` by default;
- the only source-level opt-in is exact environment value `SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED=true`;
- existing route-local authentication, admin allowlists, secrets, confirmations, and provider safeguards remain intact behind that outer gate;
- CPQ `/api/creator-publishing-queue/fanvue/run` is outside the kill switch;
- governance admin and affiliate payout admin routes are outside the kill switch;
- no provider post, OAuth action, token mutation, payment, database mutation, or scheduler mutation is performed by this closeout.

The dedicated source contract recursively inventories all current legacy Autopost admin route files and fails if that route count changes without deliberate review.

## External repository-governance finding

Read-only GitHub inspection during Phase 8I found:

- `main` has no active branch protection; and
- the repository has no GitHub ruleset.

That is an external repository setting and is **not closed by source code**. Do not claim it is fixed merely because this PR merges.

Recommended external closeout before wider launch access:

- protect `main` against direct pushes / force pushes and deletion;
- require pull requests for normal source changes;
- require the launch-critical checks already used by this repository before merge;
- preserve an intentional emergency-admin path appropriate for the sole-founder operating model rather than creating an unreviewed multi-admin workflow.

Any repository-setting mutation is separate from source merge authorization.

## Boundaries preserved

Phase 8I does **not**:

- alter Payment V2 prices, Stripe price IDs, inventory, Checkout, webhooks, claims, or billing lifecycle;
- alter Phase 7 / Phase 8 retention, deletion, export, audit, legal-hold, or policy-receipt behavior;
- alter CPQ Fanvue scheduler activation or Fanvue production publishing logic;
- enable X or Reddit for launch;
- enable video generation or offline compute;
- enable Phase 9 notifications;
- change Supabase schema or Production data;
- alter the protected Production founder/admin account.

## Acceptance criteria

Source closeout is merge-ready only when:

1. the legacy Autopost admin surface is default-off and requires an exact explicit opt-in;
2. every current legacy admin Autopost route is covered by the regression inventory;
3. CPQ Fanvue and non-Autopost admin routes are explicitly proven outside the kill switch;
4. public-path, authorization-inventory, Payment V2, Phase 8B–8H, TypeScript, and production-build gates remain green;
5. Vercel Preview is READY on the exact PR head;
6. no Production environment, provider, database, payment, or repository-setting mutation occurs as part of source merge.
