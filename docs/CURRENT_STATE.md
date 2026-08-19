# Sirens Forge Current State

**As of:** 2026-08-19

**Current operator-verified Production frontend:** `84c22b3337b3faf608965da84803c2d15cf1258a` (PR #260)

**Access posture:** dark launch; internal access only

**Canonical practical checklist:** [`LAUNCH_ROADMAP_STATUS.md`](./LAUNCH_ROADMAP_STATUS.md)

This document separates operator-verified operational facts from repository evidence. A route, test, migration, build, or deployment record does not by itself prove current external operation.

## Current verified facts

- **Repository and public site:** PR #260 is present at the current operator-verified Production frontend above. The intended anonymous public/legal route matrix was checked on Production as historical evidence; this task did not repeat a public or alias verification. PR #260 added the complaints/removal operating gate after PR #259's API inventory. The site remains dark-launch/internal-access only.
- **Current verified Production deployment:** Operator-supplied verification records Vercel deployment `dpl_CzqyGKH4zpQF9mV2jqwWrJAtmCVC` as `READY`, targeted to `production`, from Git ref `main` at exact PR #260 merge SHA `84c22b3337b3faf608965da84803c2d15cf1258a`. This task performed no deployment/promotion and does not infer current custom-domain aliases from deployment readiness.
- **Payment V2 — DONE and LOCKED / FROZEN:** The engineering contract spans PRs #197–#240, including Checkout, webhook inbox/event handling, claim/entitlement lifecycle, affiliate attribution, lifecycle behavior, inventory correction, readiness, and tests. Production configuration readiness is operator-verified green. Do not reopen this system as unfinished development.
- **Founder offer:** OG Founder is **$1,333 one-time** for lifetime founder access, capped at **50 paid seats**. Early Bird is **$29.99/month while active**, capped at **150 paid seats**. The separate 25 beta testers are outside the 200 paid founder-seat pool. PR #236 and `backend/payment-v2/tests/lock05fLaunchInventory.test.ts` record the inventory correction.
- **Payment operational hold:** A real-money V2 Production canary has not been performed and is **DEFERRED — BUDGET**, not unfinished engineering. There is no spare operating cash for a dummy charge/refund. Before any future live Stripe validation, Stripe must first be updated with the new Sirens Forge LLC business bank-account information. While that hold remains, do not recommend a charge, refund, Checkout canary, Connect onboarding, or other financial mutation.
- **Generation — compute offline:** Real image generation, identity training, and downstream real-output proof are **DEFERRED — BUDGET**. No fake, mock, or placeholder output may count as evidence. Video generation is Coming Soon and execution-disabled. The architecture remains identity-first with at most one body LoRA plus one identity LoRA. Safe static/source/schema review may continue without compute.
- **Production database security:** The operator-supplied current Production re-audit found every public table protected by RLS and no `SECURITY DEFINER` function executable by `PUBLIC`. PRs #226–#229 contain the repository hardening evidence. The protected Production admin account must never be altered; the expected dark-launch state is one real auth/admin user.
- **API authorization inventory — cross-repo DONE:** The Next.js frontend inventory covers all 88 current `app/api/**/route.ts` files and 102 exported HTTP route-methods with a bidirectional completeness/semantic regression contract. The separate Railway/FastAPI repo `playfulorigins333/sirens-forge-api` is independently covered by merged API PR #4 (`2c84f8620dc626a449740b6e946fef1388605cee`): its inventory covers 10 business endpoints plus FastAPI framework docs/schema routes and its regression test enforces the centralized fail-closed privileged-ingress predicate. Railway Production successfully deployed that exact API merge SHA. No application route behavior was changed by either inventory gate.
- **Creator Publishing Queue:** CPQ is the authoritative publishing state machine; legacy Autopost is not the Fanvue launch state machine. Fanvue provider posting machinery was proven separately. PRs #246–#255 bridge and activate Fanvue with creator/persona consent and trust gates.
- **Fanvue scheduler — active:** PR #256 installed the controlled scheduler architecture. Operator evidence records one `fanvue_cpq_cron_secret` in Supabase Vault, the `pg_net` prerequisite applied, canonical cron `sirens_forge_cpq_fanvue_runner` active every minute, and its first scheduled execution successful with HTTP 200. No publication job or post was created merely to prove activation. Recurring Fanvue scheduling is not inactive or unwired.
- **Other providers:** OnlyFans remains assisted/manual, with final live verification parked behind the legitimate external dependency tracked in issue #230. X is unavailable/non-selectable for launch. Reddit is unavailable/non-selectable and a manual placeholder. Provider capabilities are not interchangeable.
- **Phase 1 boundaries:** Tokens are not in Phase 1 (PR #232 retired the token architecture). Muse Store is post-launch. Video remains Coming Soon.

## Current open and deferred work

- **API authorization inventory:** DONE across both application repositories. Frontend: 88 route files / 102 route-methods plus semantic/completeness regression coverage. Railway/FastAPI: merged API PR #4 covering 10 business endpoints plus public framework docs/schema routes with privileged-ingress regression coverage.
- **Complaints/removal operations — source gate DONE:** `docs/operations/complaints-removal-operations.md` defines the mailbox owner role, finite case states, proposed internal triage targets, minimum-necessary evidence, escalation/decision authority, notices, append-only audit record, and five synthetic tabletops. `backend/governance/tests/complaintsRemovalOperations.test.ts` protects the workflow, public routes/intake, and truthful policy copy in hosted CI. Repository review found no dedicated complaint/removal case-management schema, service, or admin UI; the restricted non-Production record is therefore the documented launch mechanism. This does not establish human legal sufficiency, staffed execution, or Production action.
- **Observability/recovery row 48 remains OPEN:** `docs/operations/launch-observability-alerts-recovery.md` now supplies the launch-wide roles, severity/thresholds, signal/recovery matrix, redaction rules, manual cadence, incident template, and safe tabletops, protected by hosted CI. No universal automated monitoring/paging platform was found. The current private API repository could not be fetched in this environment, so its exact current SHA/source/logging/health posture is not re-verified; that explicit cross-repository audit blocker prevents honest closure.
- **DEFERRED — BUDGET:** Stripe bank-account prerequisite and real-money canary; live Stripe Connect onboarding; identity-training and image-generation real-compute proof.
- **DEFERRED — DEPENDENCY:** OnlyFans final live verification (issue #230).
- **POST-LAUNCH:** Muse Store and affiliate payout automation expansion. Video execution is not a Phase 1 capability.
- **UNKNOWN — VERIFY:** Human legal sufficiency and some end-to-end operational recovery exercises require explicit verification. Do not infer these from policy copy, routes, or code.

## Historical recovery context (2026-08-01; not current status)

On 2026-08-01, the recovery snapshot recorded commit `7522c54e83c02b0fff15b7ab57364f711cb1bf67` (PR #195), deployment `dpl_5CoPfkQ2c2jkfgwqfVwWQzok6WRi`, selected domain aliases/responses, authenticated Checkout recovery, forward cleanup migration `20260731002700_remove_checkout_incident_objects.sql`, and restored Stripe Connect server-authentication protection. At that historical checkpoint, the complete public-policy route matrix, Payment V2, and recurring Fanvue scheduler were not yet established.

Those August 1 unknowns were valid recovery evidence then, but they must not override later merged PRs and the operator-verified facts above. Applied migration history remains immutable; any correction requires a forward-only migration and separate authorization.

## Safety boundaries

1. Keep audits read-only. Never use Checkout, Stripe Connect onboarding, OAuth, posting, payments, subscriptions, entitlements, database writes, or destructive operations as probes.
2. Production changes, database or migration application, Stripe actions, environment changes, OAuth actions, provider actions, and deployment promotions each require separate explicit authorization.
3. Do not alter the protected Production admin account or manufacture users/jobs/posts as validation artifacts.
4. Do not bring generation pods online until operating cash exists; never substitute synthetic output for real-compute proof.
5. A green build does not prove Production deployment, and a Production-target deployment does not prove aliases moved. Verify commit, deployment, aliases, and safe public responses separately.
6. Preserve provider-specific truth: CPQ/Fanvue activation says nothing about OnlyFans, X, or Reddit capability.
