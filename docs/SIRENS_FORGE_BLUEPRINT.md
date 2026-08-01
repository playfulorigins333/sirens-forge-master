# Sirens Forge Blueprint

## How to read this blueprint

Every material statement uses one of these evidence labels:

- **Verified in Production** — supported by the recorded Production recovery state supplied for the 2026-08-01 baseline; this label does not imply an unrecorded end-to-end provider test.
- **Implemented but not live-tested** — code, migrations, or tests exist, but the complete external workflow is not proven live.
- **Present but inactive** — repository support exists behind a disabled gate, dormant scheduler, placeholder, or unavailable dependency.
- **Offline** — a required runtime service is known to be unavailable.
- **Planned** — an intended future capability, not a present capability.
- **Unknown / requires verification** — repository evidence cannot establish the operational fact.

The source priority is application code, migrations/schema files, tests, Git history/merged-PR metadata, then existing documentation. A route proves only that a route is present. It does not prove provider configuration, Production reachability, a successful external action, or end-to-end behavior.

## 1. Product purpose and positioning

**Implemented but not live-tested.** Sirens Forge is a subscription-oriented Next.js application for creators to build reusable AI identities, compose image/video creation requests, manage generated or uploaded media, and prepare controlled publishing workflows. The repository also contains affiliate billing and provider-specific social integration surfaces. “AI creative operating environment” is a useful description of the implemented surfaces, not proof that every workflow is operational.

**Verified in Production.** The recovered application baseline is operating in Production-only mode at commit `7522c54e83c02b0fff15b7ab57364f711cb1bf67`. Generation compute is separately **Offline**.

## 2. Current user-facing product areas

**Implemented but not live-tested.** The App Router contains landing, login, pricing, dashboard, account/billing, affiliate, Generator (`/generate`), Siren’s Mind (`/sirens-mind`), identities, library, Autopost, and creator publishing-queue views. Operator and compliance-review views also exist under the creator publishing queue.

**Unknown / requires verification.** Route presence and a successful build do not establish that every view has been exercised against the current Production database, provider configuration, authorization policy, and custom domain.

## 3. Public website and policy routes

**Implemented but not live-tested.** Repository pages exist for `/`, `/pricing`, `/faq`, `/contact`, `/terms`, `/privacy`, `/acceptable-use`, `/content-removal`, `/dmca`, `/complaints`, `/community-guidelines`, `/underage-policy`, `/age`, `/blocked-content`, `/2257-exemption`, and `/affiliate-terms`. The proxy’s explicit public allowlist is narrower: `/`, `/login`, `/pricing`, `/faq`, `/contact`, `/content-removal`, `/terms`, `/privacy`, and `/acceptable-use` (plus static/API/auth prefixes). Therefore “a page exists” and “the page is anonymously public” are not interchangeable.

**Unknown / requires verification.** The repository references `sirensforge.vip`, but it does not prove which apex or `www` aliases currently resolve, which deployment each alias serves, or the public response for every policy/contact path. Verify DNS/aliases and HTTP responses separately before calling them live.

## 4. Authentication and account model

**Implemented but not live-tested.** Supabase Auth supplies server-validated users and cookie-backed sessions. Protected UI requests pass through `proxy.ts`; API routes are public at the proxy layer and must perform their own authorization. Profiles connect an Auth user to application, Stripe-customer, affiliate, and Stripe Connect data. Active/trialing rows in `user_subscriptions` are used by subscription gates.

**Unknown / requires verification.** The complete RLS posture and the consistency of legacy `profiles.id` versus `profiles.user_id` assumptions require a fresh schema/RLS audit for any changed workflow.

## 5. Pricing, subscription, founder-seat, and entitlement concepts

**Implemented but not live-tested.** Pricing presents launch tiers named `og_throne`, `early_bird`, and `prime_access`; code describes OG as one-time and Early Bird/Prime as subscriptions. Pricing displays founder-seat concepts and retrieves counts from `/api/subscription/seat-count` rather than using fallback counts. Stripe webhook code writes subscription/access state to `user_subscriptions`.

**Unknown / requires verification.** UI copy, configured Stripe prices, database tier rows, seat-count semantics, webhook state, cancellation behavior, and actual availability must be reconciled before changing promises or capacity. Do not infer an entitlement solely from a successful redirect or Stripe session.

## 6. Current Checkout contract

**Verified in Production.** The recovered baseline uses the authenticated pre-incident Checkout contract. `/api/checkout/subscription` obtains the server-authenticated Supabase user, resolves a profile and Stripe customer, accepts only a launch-tier name plus an optional referral code, and creates a Stripe-hosted Checkout session. The abandoned guest/pay-first database objects were removed by forward migration `20260731002700_remove_checkout_incident_objects.sql`.

**Implemented but not live-tested.** OG uses Stripe payment mode; Early Bird and Prime use subscription mode. Referral metadata is carried into provider objects and an onboarded Connect destination may receive a destination charge. Webhook handlers cover Checkout completion and subscription lifecycle events.

**Unknown / requires verification.** This blueprint does not claim a paid end-to-end Checkout, webhook, entitlement, failure/retry, refund, cancellation, cross-tier, or reconciliation test on the current baseline. A future payment-first contract is **Planned**, not implemented.

## 7. Affiliate system and Stripe Connect boundary

**Implemented but not live-tested.** The affiliate page and summary API expose referral, commission, qualification, and payout concepts. Checkout resolves referral records and uses a Connect destination only when the stored profile is marked onboarded and has an account identifier.

**Verified in Production.** PR #195 restored the Connect route’s server-authentication boundary: it resolves the authenticated user on the server, selects exactly that user’s profile, delays privileged clients until authentication succeeds, scopes writes to the same identity, and sanitizes provider failures.

**Unknown / requires verification.** Restoration did **not** execute or prove live Stripe Connect account creation or onboarding. Payout eligibility, webhook synchronization, provider capabilities, and real commission transfer/reconciliation need separately authorized verification.

## 8. Image-generation and identity-training architecture

**Implemented but not live-tested.** Image requests flow through `/api/generate`, build a ComfyUI workflow, resolve identity LoRA inputs, call configured RunPod infrastructure, and best-effort log generation metadata/results in Supabase. Video routes are also present. Identity-training routes accept datasets, use object storage for inputs, maintain `user_loras` state, and expose create/upload/train/status operations.

**Unknown / requires verification.** Route implementations vary in their authentication and ownership checks; audit each server boundary, RLS policy, object-storage policy, job transition, and signed URL before enabling compute. Repository support does not prove the worker image, model assets, queues, callbacks, or output persistence are currently usable.

## 9. Current generation-pod status

**Offline.** Generation pods are offline. The application is in Production-only mode without operational generation compute. Do not claim real generation, identity training, video generation, asset persistence, or downstream post-generation behavior is operational.

**Present but inactive.** Pre-pod QA may cover builds/deploy mechanics, static UI, route existence, payload/workflow review, schema/RLS review, and non-generation flows. Fake, mock, or placeholder output is not acceptable evidence of generation.

## 10. Siren’s Mind and Generator workflows

**Implemented but not live-tested.** `/sirens-mind` provides a chat-oriented prompt workflow backed by `/api/nsfw-gpt/headless`; `/generate` provides the creation interface and is connected in code to image-generation contracts. Prompt routing, vault, macro, Comfy workflow, identity-selection, and post-generation action components are present.

**Offline.** Any step requiring generation pods—and every conclusion that depends on a real resulting asset—remains unvalidated. No post-generation workflow may be represented as validated while pods are offline.

## 11. Creator publishing queue

**Implemented but not live-tested.** The repository contains migrations, services, pages, API routes, and a substantial source/integration-test suite for package composition, media association/upload, creator approval, compliance/manual review, platform accounts, scheduling, operator work, completion evidence, history, consent, retry exhaustion, and recovery.

**Present but inactive.** Existing operations documentation records the recurring creator-publishing scheduler as disabled and without a registered cron at its documented checkpoint. That historical record must be rechecked before any current claim. Provider execution and a legitimate nonzero Production canary remain separately gated.

## 12. Social-platform integrations and autopost boundaries

**Implemented but not live-tested.** Provider-specific code exists for Fanvue and X OAuth/connection, diagnostics, availability, and controlled dispatch; platform metadata/routes also exist for OnlyFans, Fansly, ManyVids, and Reddit. Creator publishing includes assisted/manual operator boundaries, and Autopost has explicit rules, approval, pause/resume, revoke, preview, and run surfaces.

**Unknown / requires verification.** Implementation depth, provider approval, scopes, credentials, account state, runtime gates, and live proof differ by provider. Never generalize a test for one provider to another. OAuth, posting, reconnect, token refresh, live canaries, and external actions require provider-specific authorization.

## 13. Reddit placeholder lockdown status

**Present but inactive.** Reddit is deliberately locked to truthful manual-only/placeholder metadata, supported by a dedicated source-contract test. It must remain a placeholder until Reddit work is separately authorized and implemented. A route or platform card is not evidence of OAuth or posting support.

## 14. Safety, acceptable-use, consent, likeness, removal, and compliance controls

**Implemented but not live-tested.** Public-facing acceptable-use, privacy, terms, community, underage, blocked-content, complaints, DMCA, content-removal, age, and 2257-exemption pages exist. Creator-publishing code and migrations include AI-twin consent, compliance submissions, verification, manual review, approval gates, platform policies, media access controls, and safety-guard tests.

**Unknown / requires verification.** Legal sufficiency, anonymous accessibility of every policy route, operational complaint/removal handling, retention/deletion execution, age/consent enforcement throughout generation, and jurisdiction/provider compliance require human legal/operational review. Do not treat policy copy alone as enforcement proof.

## 15. Supabase responsibilities

**Implemented but not live-tested.** Supabase supplies authentication, Postgres persistence, RLS/policies, RPCs, webhook-derived subscription data, profiles, generation/identity records, affiliate data, connected-account state, Autopost state, and publishing-queue orchestration. Service-role clients are privileged and belong only behind server-authenticated, authorization-checked routes.

**Unknown / requires verification.** Repository migrations describe intended schema evolution but do not by themselves prove the remote schema, migration ledger, RLS state, cron state, data integrity, or environment-to-project mapping. Confirm those read-only before planning a write.

## 16. Migration policy

**Verified in Production.** Checkout incident migrations 02100–02600 remain immutable history; cleanup was performed forward-only in 02700.

Applied migrations must never be edited, reordered, or deleted. Research the remote ledger and schema read-only first. A correction requires a new, idempotent where practical, forward migration with preconditions, safe failure, preservation checks, rollback/repair reasoning, review, and separate authorization to apply. Committing SQL does not authorize a database write.

## 17. Stripe responsibilities

**Implemented but not live-tested.** Stripe owns customer/payment/subscription Checkout sessions, billing portal behavior, webhook events, Connect accounts/account links, destination charges, and external payment state. Sirens Forge maps authenticated profiles and tiers to these objects and projects relevant state into Supabase.

Use server-authenticated identity on every privileged route, verify webhook signatures, sanitize provider errors, avoid exposing identifiers unnecessarily, and design idempotency plus reconciliation before payment-first work. Provider object creation, Checkout, refunds, subscription changes, Connect onboarding, and other Stripe actions require separate authorization.

## 18. Vercel deployment model

**Verified in Production.** The recorded recovery promoted commit `7522c54e83c02b0fff15b7ab57364f711cb1bf67` to Production after the recovery and Connect-security PRs.

**Unknown / requires verification.** Git, a green build, a successful Vercel deployment, a Production-target label, and custom-domain aliases are separate facts. For an authorized promotion, record the Git SHA and deployment identifier, verify the target, explicitly verify apex/`www` aliases, and make safe public GET/HEAD requests. Never use an external mutation as a smoke test.

## 19. Repository structure

- `app/`: Next.js App Router pages and API routes.
- `components/`, `hooks/`: shared UI and client state.
- `lib/`: application contracts, Supabase/Stripe helpers, generation workflow logic, Autopost adapters, and publishing services.
- `backend/`: domain services, provider/runbook documentation, fixtures, and tests.
- `supabase/migrations/`: immutable database evolution history.
- `scripts/`: safety and operational helpers.
- `prompts/`: Siren’s Mind/headless prompt assets and routing contracts.
- `docs/`: operational evidence, research, runbooks, this blueprint, and incident records.
- `.github/workflows/`: repository CI definitions.

## 20. Testing strategy

**Implemented but not live-tested.** The repository uses TypeScript/source-contract tests, dependency-injected route tests, safety guards, SQL/Postgres integration harnesses, and Next.js builds. `package.json` exposes focused suites for creator publishing, X Autopost, and Reddit lockdown; additional tests are invoked individually or by workflows.

For each change, start with diff/scope checks, then run the narrowest relevant tests, broader domain suites, type/build validation where warranted, migration/static policy checks, and authorized environment verification. Separate tests that require external credentials or Postgres. A passing build is not Production proof; a route test is not provider proof; dry-run evidence is not a live external action.

## 21. Operational safety rules

1. Verify branch, SHA, worktree, repository evidence, remote state, deployment, and terminal output.
2. Mark fact, inference, theory, and unknown distinctly; record conflicts.
3. Use one task branch, one narrow PR, and the smallest controlled change; never work directly on `main`.
4. Treat database, migration, Stripe, environment, OAuth, deployment, alias, provider, and Production actions as separately authorized gates.
5. Keep audits read-only; never invoke Checkout, Connect onboarding, OAuth, posting, payments, subscriptions, entitlements, or destructive operations as probes.
6. Preserve applied migrations and use forward-only repairs.
7. Protect privileged APIs with server-authenticated identity plus resource authorization and sanitized errors.
8. Verify deployments, aliases, and public responses independently.
9. Never use placeholder output to claim generation success.

## 22. Known incomplete or unverified areas

- **Offline:** generation pods and all real-compute/post-generation proof.
- **Planned:** a redesigned payment-first Checkout contract.
- **Present but inactive:** Reddit placeholder; creator-publishing recurring scheduling at its last documented checkpoint.
- **Unknown / requires verification:** current custom-domain alias mapping and route responses; remote migration/RLS/cron state beyond the recorded checkout recovery; current provider configuration/scopes; comprehensive API authorization; complete paid Checkout/webhook/entitlement/reconciliation behavior; live Connect onboarding; legal/operational execution of safety policies; provider-by-provider publishing readiness.
- **Conflict to preserve:** several policy pages exist, but `proxy.ts` does not explicitly list all of them as public. Public accessibility must be tested rather than inferred.

## 23. Recommended engineering sequence

1. Preserve the recovered stable baseline and keep this documentation current.
2. Perform a read-only architecture, remote-schema/RLS, provider-contract, and deployment/alias audit.
3. Define future payment-first state transitions, authenticated claim rules, provider metadata, and UI/API contracts before code.
4. Design webhook idempotency, entitlement uniqueness, expiration, retry, concurrency, reconciliation, observability, and manual repair.
5. Implement in narrow layers with tests and forward-only migrations; stage schema, server, webhook, and UI activation.
6. Restore generation infrastructure as a separate effort when compute is available; validate real outputs without mixing it with Checkout redesign.
7. Advance social integrations one provider at a time under separate authorization.

## 24. Definition of done for future features

A feature is done only when its contract and non-goals are documented; code, authorization, ownership, validation, errors, telemetry, tests, and policy implications are reviewed; schema changes are forward-only and safely applied under separate authorization; secrets stay server-side; idempotency/reconciliation and rollback/repair paths exist where money or asynchronous providers are involved; the exact commit is deployed under authorization; custom aliases and safe public responses are verified; and the intended legitimate workflow is tested at the authorized level. Remaining offline, inactive, planned, and unverified behavior must be stated explicitly. Build or deployment success alone is never the definition of done.
