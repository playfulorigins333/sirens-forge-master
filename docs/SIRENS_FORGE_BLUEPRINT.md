# Sirens Forge Blueprint

## How to read this blueprint

This architectural overview is reconciled through 2026-08-19 at verified main `a11f1b9e73fc3d9dfc4793757257480d160d56f5` (PR #257). Operational claims explicitly identified as **operator-verified** are supplied current-state evidence. Repository files, tests, migrations, and routes establish implementation evidence only; they do not independently prove Production configuration or an external action. See [`CURRENT_STATE.md`](./CURRENT_STATE.md) and the canonical [`LAUNCH_ROADMAP_STATUS.md`](./LAUNCH_ROADMAP_STATUS.md).

## 1. Product and launch posture

Sirens Forge is a creator application for identity-first AI image composition, reusable AI identities, media management, controlled creator publishing, subscriptions, and affiliate operations. It is still dark-launch/internal-access only. Tokens are not part of Phase 1, Muse Store is post-launch, and video generation is Coming Soon with execution disabled.

Current Production/frontend main is operator-verified at PR #257. Generation compute is offline for budget reasons. Product surfaces and static contracts must never be represented as real-compute proof.

## 2. Public site, access shell, and policy routes

Pages exist for the homepage, pricing, FAQ, contact, terms, privacy, acceptable use, content removal, DMCA, complaints, community guidelines, underage policy, age, blocked content, 2257 exemption, and affiliate terms. PR #239 aligned anonymous allowlisting with the intended policy set; `backend/security/tests/publicPathContract.test.ts` protects the contract. PR #250 performed the current frontend security/accessibility/readiness sweep, and PR #257 corrected FAQ/footer claims and regression-tested them.

**Operator-verified:** the full intended anonymous public/legal route matrix has been checked on current Production and that gate is closed. The sitemap contains the correct public route set. Current custom-domain alias ownership must still be separately re-recorded rather than inferred from a successful deployment or the historical August 1 alias check.

## 3. Authentication, accounts, and authorization

Supabase Auth provides cookie-backed, server-validated identity. Profiles connect Auth users to application, billing, affiliate, and Connect state. Protected pages pass through `proxy.ts`; API routes must enforce their own authentication, ownership, entitlement, and administrator boundaries. PRs #221–#225 hardened generation, Siren’s Mind, legacy LoRA, admin-X, and authenticated API caller boundaries; PRs #234 and #238 hardened account/billing and profile-FK behavior.

**Operator-verified Production security:** all public tables are protected by RLS and no `SECURITY DEFINER` function is executable by `PUBLIC`. PRs #226–#229 provide repository hardening contracts. The single real dark-launch auth/admin user is expected and protected; it must never be altered. These facts do not remove the need for route-local authorization review as APIs evolve.

## 4. Pricing, founder inventory, and launch entitlements

The paid founder pool is exactly 200 seats:

- **OG Founder:** 50 paid seats; $1,333 one-time; lifetime founder access.
- **Early Bird:** 150 paid seats; $29.99/month while active.
- **Beta:** 25 separate testers, not counted within those 200 paid seats.

PR #236 and `backend/payment-v2/tests/lock05fLaunchInventory.test.ts` record the 50/150 correction. Pricing and seat-count surfaces were aligned in PRs #216–#218. Do not reintroduce the obsolete lower capacity from historical migration text or fold beta testers into founder inventory.

## 5. Payment V2 contract — DONE and LOCKED / FROZEN

Payment V2 is not a future design proposal. Its engineering is complete and frozen. PRs #197–#203 created the database, public Checkout, webhook, claim, success/auth-continuation, protection, and launch-inventory layers. PRs #206–#219 added event-inbox isolation, affiliate security and attribution, authenticated read boundaries, payout controls, live seat tracking, pricing alignment, and fail-closed public behavior. PRs #234–#240 completed account/billing lifecycle, Early Bird subscription lifecycle, final inventory cleanup, profile integrity, public paths, and readiness handling.

The system covers Checkout implementation, verified webhook/event ingestion, idempotent claim/entitlement lifecycle, subscription transitions, affiliate attribution/obligations, seat accounting, and reconciliation/readiness contracts. Production configuration readiness is operator-verified green.

No real-money V2 Production canary has run. This is **DEFERRED — BUDGET**, not an unfinished engineering gate. Before future live validation, Stripe must be updated with the new Sirens Forge LLC business bank account. Until operating cash exists and separate authorization is supplied, do not recommend or execute a charge, refund, Checkout canary, Connect onboarding, or other financial mutation.

## 6. Affiliate and Stripe Connect boundary

Payment V2 carries immutable referral attribution into commission obligations. PRs #207–#213 cover affiliate security, attribution, recurring commission/payout contracts, scheduling, and authenticated summary reads. Stripe Connect remains server-authenticated and identity-scoped (PR #195); payout and onboarding actions remain separately authorized financial operations.

Repository automation does not prove a live payout. Live Connect onboarding is budget-deferred with the Stripe hold. Broader payout automation is post-launch; current controls must remain fail-closed.

## 7. Identity-first generation architecture

Generation remains identity-first. A generation may use at most **one body LoRA plus one identity LoRA**. PRs #221, #223, #241, and #250 provide subscription, mutation, ownership, and frontend gate hardening. Identity ownership and dataset/training routes must preserve authenticated ownership, storage isolation, finite state transitions, and safe errors.

Generation pods remain offline because the operating budget cannot support compute. Real image-generation proof and real identity-training proof are **DEFERRED — BUDGET**. Only static UI, source, payload/workflow, schema/RLS, build, route, and non-generation checks may continue. Fake, mock, or placeholder output is never launch evidence.

Video routes may remain as guarded repository history, but video execution is disabled and the product promise is Coming Soon. Video is not currently available.

## 8. Siren’s Mind, Generator, library, and media

`/sirens-mind` supplies the prompt-oriented experience and `/generate` composes image requests. Library/media, upload, signed-access, and generated-asset selection surfaces exist. Siren’s Mind access is subscription-gated (PR #220); generation authorization and identity ownership were hardened in PRs #221 and #250.

Static contracts can be reviewed today, but any statement depending on a real generated asset, identity-training result, persistence callback, or post-generation action remains compute-dependent. Library/uploaded-media behavior is distinct from real-generated-media proof.

## 9. Creator Publishing Queue architecture

CPQ is the authoritative publishing state machine. It owns creator packages, media, consent/compliance facts, platform accounts, plans/jobs, scheduler events, attempts, history, manual review, recovery, and provider execution gates. Legacy Autopost is not the authoritative Fanvue launch state machine.

The repository contains migrations, services, routes, and focused tests for these layers. PR #242 gates CPQ by paid entitlement. Provider capability remains provider-specific; one provider’s result cannot approve another provider.

## 10. Fanvue capability and recurring scheduler

Fanvue engineering/provider posting machinery has already been proven separately and must not be reopened merely to obtain another proof post. PRs #243–#249 locked the architecture, bridged OAuth/account state into CPQ, extracted the execution core, and installed the worker/capability machinery. PRs #251–#255 enabled generated-media preparation, public/trust gates, and Fanvue V2 creator/persona consent.

PR #256 installed the guarded scheduler architecture. **Operator-verified Production state:** `fanvue_cpq_cron_secret` exists exactly once in Supabase Vault; the `pg_net` prerequisite migration is applied; canonical cron `sirens_forge_cpq_fanvue_runner` runs every minute; and its first scheduled execution succeeded with HTTP 200. No publication job or provider post was created solely for scheduler proof. Fanvue public activation, worker, and scheduler application gates are on. Recurring Fanvue scheduling is active, not disabled or unwired.

## 11. Other provider capabilities

- **OnlyFans:** assisted/manual only. Final live verification is **DEFERRED — DEPENDENCY** behind the legitimate external condition recorded in issue #230. Internal CPQ scheduling/history does not imply direct OnlyFans posting.
- **X:** unavailable and non-selectable for launch, irrespective of dormant/historical integration code.
- **Reddit:** unavailable and non-selectable; truthful manual-placeholder behavior is protected by `backend/autopost/tests/redditPlaceholderLockdown.test.ts`.

Never summarize these providers as equally supported, and never use OAuth/posting/provider actions as audit probes.

## 12. Consent, likeness, and complaints/removal governance

Policy routes and CPQ controls cover acceptable use, underage/blocked content, creator consent, AI-twin/AI-persona facts, compliance review, complaints, DMCA, and content removal. PR #255 and migration `20260818164748_cpq_fanvue_ai_persona_policy_correction.sql` apply Fanvue V2 creator/persona consent.

Policy copy and schema controls are not proof of a staffed operational workflow or legal sufficiency. The complaints/removal operational workflow remains an appropriate zero-spend OPEN gate: document ownership, intake, triage, deadlines, evidence retention, escalation, action, notification, and audit proof without mutating Production during design.

## 13. Supabase and migration discipline

Supabase supplies Auth, Postgres, RLS, storage-related state, RPCs, subscriptions, affiliate obligations, identities/generations, and CPQ orchestration. Service-role access belongs only behind server-authenticated, authorization-checked routes. Current Production RLS/function exposure facts are recorded in Section 3.

Applied migrations are immutable history. Never edit, reorder, or delete them. Any correction requires read-only evidence, a new forward-only migration, safe preconditions and failure behavior, preservation/repair reasoning, review, and separate authorization to apply. Repository SQL does not authorize a Production write.

## 14. Deployment, domains, and observability

PR #257 is the current operator-verified Production/frontend main. Historical August 1 evidence for PR #195 and deployment `dpl_5CoPfkQ2c2jkfgwqfVwWQzok6WRi` remains useful history, not current deployment truth.

For every authorized promotion, verify Git SHA, deployment identifier/target, apex and `www` aliases, and safe public responses as separate facts. A green build, Production target, or route file proves none of the others. Continue zero-spend work on sanitized observability, finite error codes, scheduler/payment recovery runbooks, and operator-safe alerting without exercising external mutations.

## 15. Repository and testing map

- `app/`: App Router pages and API routes.
- `components/`, `hooks/`, `lib/`: shared UI/state and domain/application contracts.
- `backend/`: domain services, provider logic, and focused tests.
- `supabase/migrations/`: immutable forward schema history; `supabase/manual/`: separately authorized operator artifacts.
- `docs/`: architecture decisions, audit evidence, runbooks, current state, and roadmap.
- `.github/workflows/`: CI contracts.

Use diff/scope checks first, then focused source/route tests, domain suites, static migration/security checks, type/build validation when warranted, and finally separately authorized environment verification. A test is not Production proof; dry-run evidence is not an external action.

## 16. Known incomplete, deferred, and unknown areas

- **LOCKED / FROZEN:** Payment V2 engineering.
- **DONE:** intended public/legal matrix verification; Production Payment V2 readiness; Production RLS and privileged-function audit; Fanvue capability and recurring scheduler activation.
- **DEFERRED — BUDGET:** Stripe business-bank prerequisite and real-money V2 canary, live Connect onboarding, identity-training compute proof, image-generation compute proof.
- **DEFERRED — DEPENDENCY:** OnlyFans final live verification (issue #230).
- **OPEN:** comprehensive API authorization review; complaints/removal operating workflow; remaining observability, alerting, and manual-recovery closure.
- **POST-LAUNCH:** Muse Store and expanded affiliate payout automation. Video generation remains Coming Soon/execution-disabled rather than a Phase 1 capability.
- **UNKNOWN — VERIFY:** fresh custom-domain alias ownership record; human legal sufficiency; any operational fact not covered by current operator evidence.

## 17. Recommended engineering sequence

1. Preserve Payment V2 and its 50/150 inventory as frozen; keep provider and compute holds explicit.
2. Complete the zero-spend API authorization inventory and close any route-local ownership/admin/entitlement evidence gaps without external actions.
3. Formalize and tabletop the complaints/removal workflow using non-Production fixtures and documented roles.
4. Close sanitized observability, alerting, and manual-recovery documentation gaps for asynchronous systems.
5. Maintain public copy/route regression coverage and separately re-record aliases after any authorized deployment.
6. When operating cash exists, update Stripe business bank information under separate authorization, then separately authorize a minimal real-money V2 canary and reconciliation. Do not treat this as engineering continuation.
7. Restore identity-training/image-generation compute only when funded; validate genuine outputs without mixing the effort with payments or publishing.
8. Keep OnlyFans parked on issue #230; keep X and Reddit unavailable; advance providers only through provider-specific gates.

## 18. Operating safety and definition of done

Verify branch, SHA, worktree, evidence, deployment, aliases, and terminal output before claims. Keep audits read-only. Production, database, migration application, Stripe, environment, OAuth, provider, generation, and deployment actions each need separate explicit authorization. Protect the Production admin account and preserve applied history.

A feature may be engineering-complete while an external validation is legitimately deferred. Definition of done must therefore state both the completed contract and any separate operational proof gate. It includes documented contract/non-goals, authorization and ownership review, validation/errors/telemetry, tests, policy implications, idempotency/reconciliation and repair for asynchronous or monetary work, and the precisely authorized level of environment proof. It never permits fake generation output or turns a budget hold into new engineering scope.
