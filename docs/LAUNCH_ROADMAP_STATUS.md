# Sirens Forge Launch Roadmap Status

**Canonical practical launch checklist — 2026-08-19**

**Last independently verified frontend Production baseline before this change:** `7f479c9fae367d540bdcd1a51009c7760002b73d` (PR #262 merged/Production)

**Last independently verified API Production baseline before this change:** `b357ff918a30ba4e771b798f591a1611cf8a4d97` (API PR #5 merged/Production). This cleanup performed no deployment, alias verification, or public-response verification.

**Launch posture:** dark launch; internal access only

## Status rules

Only the status labels in this table are valid. **DONE** means the stated gate has sufficient repository or supplied operator evidence. **LOCKED / FROZEN** means completed scope that must not be reopened. **DEFERRED — BUDGET** and **DEFERRED — DEPENDENCY** are not unfinished engineering. **OPEN** identifies actionable, non-frozen work; rows marked **$0 today: yes** are the only immediate candidates. **UNKNOWN — VERIFY** is used where code cannot establish an operational fact. A route, build, migration, or test never proves an external action by itself.

## Granular launch gates

| ID | Area | Gate / deliverable | Status | Evidence | Remaining action | Dependency / blocker |
|---:|---|---|---|---|---|---|
| 01 | Repository | Current main and roadmap baseline reconciled | DONE | Operator-supplied Git main evidence through PR #262 SHA `7f479c9fae367d540bdcd1a51009c7760002b73d`; canonical roadmap/current-state reconciliation. | Keep docs aligned after merges | None; $0 today: maintenance only |
| 02 | Deployment | Current frontend deployment corresponds to verified main | DONE | Operator-supplied frontend PR #262 Production/main baseline `7f479c9fae367d540bdcd1a51009c7760002b73d`; no deployment identifier or alias claim added by this cleanup | Reverify after any separately authorized promotion | Deployment actions require separate authorization; this task did not deploy |
| 03 | Domains | Current apex/`www` and Vercel aliases recorded against current deployment | DONE | Historical read-only alias verification exists for PR #258 deployment `dpl_JDBkmjJFYX8oZtfATL88Tmp6L5zN`; the PR #261 deployment identity/state/SHA is operator-verified, but aliases were not independently rechecked for that promotion | Re-verify deployment identity, aliases, and custom-domain serving separately after every future authorized Production promotion | Maintenance only; future promotions separately authorized |
| 04 | Public site | Homepage anonymous response and launch posture | DONE | Operator-verified public route matrix; PRs #239, #250, #257 | Preserve dark-launch truth in regression tests | None; $0 today: maintenance only |
| 05 | Public site | Intended policy/legal routes anonymously reachable | DONE | Operator-verified Production matrix; PR #239; `backend/security/tests/publicPathContract.test.ts` | Maintain route contract | None; $0 today: maintenance only |
| 06 | Public site | FAQ/footer/pricing copy truthfully reflects launch scope | DONE | PR #257 correction/regression protection; PRs #216–#218 pricing alignment | Review on offer/scope changes | None; $0 today: maintenance only |
| 07 | Public site | Sitemap contains intended public route set | DONE | Operator-verified fact; repository sitemap | Maintain with public-route changes | None |
| 08 | Access | Age/access shell and underage/blocked-content boundaries | DONE | Public age, underage-policy, blocked-content routes; PR #250 frontend readiness tests | Maintain source/UI coverage | None; does not establish legal sufficiency |
| 09 | Identity | Authentication/session boundary | DONE | Supabase server-auth patterns; PRs #221–#225 and #234 | Maintain server-authenticated identity | None |
| 10 | Identity | Profile/account ownership and Auth FK model | DONE | PRs #231, #234, #238; account/billing tests and migration contracts | Maintain identity-scoped reads/writes | Protected admin must not be altered |
| 11 | Authorization | Protected-page authorization | DONE | `proxy.ts`; PR #250 frontend launch-readiness sweep | Maintain when adding pages | None |
| 12 | Authorization | Comprehensive route-local API authorization inventory | DONE | Frontend PR #259 inventory: 88 `app/api/**/route.ts` files / 102 exported route-methods with bidirectional completeness and semantic regression assertions. Separate Railway/FastAPI repo API PR #5 is operator-confirmed merged/Production at `b357ff918a30ba4e771b798f591a1611cf8a4d97`; its identity-bearing generation path fails closed without worker/shared-filesystem materialization proof. The inventory established in API PR #4 covers 10 business endpoints plus public framework docs/schema routes, with regression coverage for the centralized fail-closed privileged-ingress predicate. | Maintain both repository inventories whenever routes or authorization boundaries change | None; $0 source/test maintenance |
| 13 | Database security | All public Production tables protected by RLS | DONE | Operator-verified Production re-audit; PR #226 repository hardening | Re-audit read-only after schema changes | No Production mutation authorized |
| 14 | Database security | No `SECURITY DEFINER` function executable by `PUBLIC` | DONE | Operator-verified audit; PRs #228–#229 | Maintain signature/exposure guards | No Production mutation authorized |
| 15 | Pricing | Launch prices and lifetime/monthly semantics | LOCKED / FROZEN | PRs #216–#218; `app/pricing/PricingClient.tsx`: $1,333 one-time and $29.99/month | Copy-only maintenance if facts change | Payment V2 frozen |
| 16 | Inventory | OG Founder paid capacity = 50 | LOCKED / FROZEN | PR #236; `backend/payment-v2/tests/lock05fLaunchInventory.test.ts` | Preserve 50 paid-seat cap | 25 beta testers are separate |
| 17 | Inventory | Early Bird paid capacity = 150 | LOCKED / FROZEN | PR #236; `backend/payment-v2/tests/lock05fLaunchInventory.test.ts` | Preserve 150 paid-seat cap | Do not restore obsolete historical capacity |
| 18 | Payment V2 | Public payment-first Checkout implementation | LOCKED / FROZEN | PRs #197–#203; `app/api/checkout/subscription-v2/route.ts`; Payment V2 test scripts | No engineering changes; preserve fail-closed gates | Operational canary is separate |
| 19 | Payment V2 | Webhook signature, inbox, replay and event handling | LOCKED / FROZEN | PRs #199, #206, #240; `app/api/webhook/payment-v2/route.ts`; `test:pfc-04`, `test:pfc-07e-a1` | Maintain tests only | No live Stripe probe |
| 20 | Payment V2 | Claim and entitlement lifecycle | LOCKED / FROZEN | PRs #200–#202, #234–#235; claim routes; `test:pfc-05`, `test:lock05e` | No reopening | Operational validation separate |
| 21 | Payment V2 | Reconciliation/readiness and safe recovery contract | LOCKED / FROZEN | PR #240; readiness route and Payment V2 contract/readiness tests | Preserve operator/runbook evidence | No financial mutation |
| 22 | Payment V2 | Production configuration readiness green | DONE | Operator-verified Production readiness green | Recheck read-only before eventual canary | Environment changes separately authorized |
| 23 | Stripe | Update Sirens Forge LLC business bank account | DEFERRED — BUDGET | Operator-required prerequisite and current no-cash hold | Authorized operator updates Stripe before any live payment validation | Operating cash; private financial action |
| 24 | Stripe | Real-money V2 Checkout/webhook/claim/reconciliation canary | DEFERRED — BUDGET | Operator confirms it has not run; Payment V2 engineering remains frozen | After row 23, separately authorize minimal charge/refund and reconcile evidence | Operating cash; Stripe bank update; authorization |
| 25 | Affiliate | Immutable referral attribution into Payment V2 | LOCKED / FROZEN | PRs #207–#208; migrations 03000–03100; affiliate contract tests | Preserve attribution and window rules | Payment V2 frozen |
| 26 | Affiliate | Commission obligation/ledger lifecycle | LOCKED / FROZEN | PRs #208, #211, #213; affiliate migrations/tests and summary read boundary | Maintain reconciliation controls | No live transfer implied |
| 27 | Affiliate | Automated payout execution expansion | POST-LAUNCH | Existing admin payout route and PRs #211–#212 establish guarded foundations, not a launch requirement | Define post-launch approvals, reconciliation and recovery | Live Stripe/Connect funds and authorization |
| 28 | Stripe Connect | Server-authenticated identity and error boundary | DONE | PR #195; current blueprint security boundary | Preserve identity-scoped access | None |
| 29 | Stripe Connect | Live account creation/onboarding validation | DEFERRED — BUDGET | Operator budget hold expressly prohibits Connect onboarding | After row 23 and funding, separately authorize one legitimate onboarding | Operating cash/business-bank prerequisite |
| 30 | Generation | Image-generation application/workflow contract | DONE | `/api/generate`; PRs #221, #241, #250; static/source tests | Maintain safe static/source/schema checks | Does not prove compute output |
| 31 | Generation | AI Twin identity ownership and one-body/one-identity LoRA rule | DONE | PRs #241, #250, and #262; identity/LoRA ownership tests; metadata-only resolver and workflow contract tests; operator architecture fact. The frontend verifies owned completed metadata and builds the complete workflow without downloading or materializing worker files. API PR #5 is merged/Production at `b357ff918a30ba4e771b798f591a1611cf8a4d97`. | Maintain ownership and maximums; before compute restoration prove worker/shared-filesystem materialization | API identity-bearing generation fails closed until that worker-side gate is proven |
| 32 | Generation | Identity-training real-compute proof | DEFERRED — BUDGET | Operator confirms pods offline and proof deferred | Fund compute, then authorize genuine training validation | Operating cash; pods offline |
| 33 | Generation | Image-generation real-compute and persistence proof | DEFERRED — BUDGET | Operator confirms pods offline; fake output prohibited | Fund compute, then validate genuine output/persistence | Operating cash; pods offline |
| 34 | Generation | Video generation execution | POST-LAUNCH | PR #222 fail-closes unavailable video; operator says Coming Soon/execution disabled | Re-scope and fund after launch; do not market as available | Compute/product decision |
| 35 | Product | Siren's Mind application/access contract | DONE | PR #220; `/sirens-mind` and paid API gate | Maintain static and authorization checks | Real generated output remains compute-dependent |
| 36 | Product | Library/uploaded-media ownership and access | DONE | PR #250 and CPQ media-access/upload tests | Maintain ownership/signed-access tests | Generated-media proof depends on row 33 |
| 37 | Publishing | CPQ authoritative queue/state machine | DONE | CPQ migrations/services/tests; PR #242 entitlement gate; Fanvue ADR | Maintain CPQ as sole launch authority | Legacy Autopost is non-authoritative |
| 38 | Publishing | Queue retry exhaustion and manual recovery contract | DONE | `docs/creator-publishing/task21-onlyfans-reliability-operations.md`; applied migration evidence recorded there | Maintain finite codes/runbook | Any Production recovery needs authorization |
| 39 | Fanvue | Provider posting capability and worker | LOCKED / FROZEN | PRs #243–#249; Fanvue executor/worker tests; operator says machinery proven separately | Do not create another proof post | Provider actions separately authorized |
| 40 | Fanvue | Public/trust/generated-media/consent application gates | DONE | PRs #251–#255; consent migration and CPQ tests | Maintain persona/creator consent | No provider post needed |
| 41 | Fanvue | Canonical recurring CPQ scheduler active | DONE | PR #256; operator evidence: one Vault secret, `pg_net` applied, named cron every minute, first HTTP 200 | Monitor safely; preserve activation/deactivation runbook | No job/post was created for proof |
| 42 | OnlyFans | Assisted/manual workflow and final live verification | DEFERRED — DEPENDENCY | ADR and task20/task21 docs; operator directs preservation of issue #230 | Keep assisted/manual; verify only after legitimate external dependency resolves | Issue #230; no unofficial API/browser automation |
| 43 | X | Launch availability | DEFERRED — DEPENDENCY | Operator states unavailable/non-selectable for launch | Keep non-selectable; reassess only in provider-specific future scope | External/provider availability |
| 44 | Reddit | Launch availability/manual placeholder | DEFERRED — DEPENDENCY | Operator fact; `backend/autopost/tests/redditPlaceholderLockdown.test.ts` | Keep unavailable/non-selectable and truthful | External/provider scope |
| 45 | Governance | Creator likeness and AI-persona consent controls | DONE | PR #255; migration `20260818164748_cpq_fanvue_ai_persona_policy_correction.sql`; AI-twin consent tests | Maintain consent version/hash and provider policy | Human legal review remains distinct |
| 46 | Governance | Complaints/removal operating workflow | DONE | `docs/operations/complaints-removal-operations.md`; `backend/governance/tests/complaintsRemovalOperations.test.ts`; truthful `app/content-removal/page.tsx` alignment. Repository review found no dedicated case-management schema/service/admin UI. | Maintain the runbook, public intake/policy truth, CI contract, and operator-approved internal targets | Human legal sufficiency and real staffing/execution remain separate; no Production action authorized |
| 47 | Frontend | Accessibility, SEO, sitemap, error/loading shell | DONE | PR #250 sweep; PR #257 regressions; sitemap and app shell files | Maintain regression coverage | None |
| 48 | Operations | Sanitized observability, alerts and recovery closure | DONE | `docs/operations/launch-observability-alerts-recovery.md`; `backend/operations/tests/launchObservabilityRecovery.test.ts`; historical API read-only audit at `2c84f8620dc626a449740b6e946fef1388605cee`; current operator-supplied API Production baseline `b357ff918a30ba4e771b798f591a1611cf8a4d97` (API PR #5). The audit confirms 10 business routes, centralized fail-closed ingress, no custom API health endpoint, and no proven secret leak; the API repository was not modified. | Keep matrix/runbooks aligned when routes or signals change; perform safe launch-period checks; separately authorize real recovery mutations | Maintenance only; no automated paging or 24/7 staffing implied |
| 49 | Operations | Public/legal route operational regression check | DONE | Operator-verified current Production matrix; PRs #239 and #257 | Repeat safe GET/HEAD check after authorized promotions | No mutating smoke tests |
| 50 | Security | Protected sole Production admin preserved | LOCKED / FROZEN | Operator fact; PR #254 sole-admin founder bootstrap | Never alter/delete during testing or audits | Absolute safety boundary |
| 51 | Launch scope | Economic tokens excluded from Phase 1 | LOCKED / FROZEN | PR #232 token retirement migration/tests; operator scope fact | Do not reintroduce for launch | Frozen scope |
| 52 | Post-launch | Muse Store | POST-LAUNCH | Operator scope fact; no Phase 1 requirement | Product discovery after launch | Post-launch prioritization |

## Next zero-spend engineering candidates

There is no presently actionable zero-spend engineering gate. `OPEN = 0` does not complete deferred funding, external-dependency, frozen, or post-launch scope and authorizes no Production, payment, database, OAuth, provider, or generation action.

## Count by status

| Status | Rows |
|---|---:|
| DONE | 29 |
| LOCKED / FROZEN | 12 |
| DEFERRED — BUDGET | 5 |
| DEFERRED — DEPENDENCY | 3 |
| OPEN | 0 |
| POST-LAUNCH | 3 |
| UNKNOWN — VERIFY | 0 |
| **Total** | **52** |

## Non-action safety record

This roadmap does not authorize or record any Production mutation, SQL execution, migration application, Supabase write, Vercel/environment change, Stripe call, bank update, charge, refund, Checkout session, Connect onboarding, OAuth action, provider post, generation request, pod start, protected-admin change, deployment, or branch merge. Each such action remains a separately authorized gate.
