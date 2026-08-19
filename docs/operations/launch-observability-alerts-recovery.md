# Launch observability, alerts, and recovery operating contract

**Status:** source-backed, zero-spend operating contract; roadmap row 48 is DONE.

**Scope:** `playfulorigins333/sirens-forge-master` (Vercel/Next.js) and `playfulorigins333/sirens-forge-api` (Railway/FastAPI), plus Supabase, Stripe/Payment V2, affiliates, CPQ/Fanvue, authentication/session, subscription/entitlement, and the budget-disabled generation boundary.

## 1. Purpose and authority boundary

This contract tells launch operators what source-backed signals to check, how to sanitize evidence, who owns triage, and which existing recovery material to use. It configures no paid monitoring platform, proves neither universal automated alerting nor 24/7 staffing, authorizes no Production mutation, and does not prove that a deployment is serving a custom domain. Real recovery actions require their own authorization.

The frontend source at `84c22b3337b3faf608965da84803c2d15cf1258a` was inspected. The separate API repository was independently audited read-only at current `main` SHA `2c84f8620dc626a449740b6e946fef1388605cee` and was **not modified**. Railway Production reports `SUCCESS` on `main` at that exact SHA. Deployment success is deployment evidence only; it does not prove generation compute availability or generated output.

The current API audit confirms `app/main.py` remains the FastAPI v3.4 entrypoint; exactly 10 business endpoints remain; and `/openapi.json`, `/docs`, `/docs/oauth2-redirect`, and `/redoc` remain public framework routes. There is **no custom API health/readiness endpoint**; this contract neither invents nor requests one. Privileged business ingress remains centrally fail closed through `require_internal_ingress_auth`: `SIRENS_API_INTERNAL_SECRET` is compared to `x-sirens-api-internal-secret` with `secrets.compare_digest`; a missing/blank configured secret yields HTTP 503 `INTERNAL_AUTH_NOT_CONFIGURED`, while a missing/wrong request secret yields HTTP 401 `UNAUTHORIZED`.

The 10 confirmed business routes are `POST /gateway/generate`, `POST /generate`, `POST /api/generate`, `POST /dataset-doctor/jobs`, `POST /dataset-doctor/jobs/{job_id}/images`, `POST /dataset-doctor/jobs/{job_id}/analyze`, `GET /dataset-doctor/jobs/{job_id}`, `GET /dataset-doctor/jobs/{job_id}/images`, `POST /dataset-doctor/jobs/{job_id}/approve`, and `POST /dataset-doctor/jobs/{job_id}/uploads`. Dataset Doctor requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at import/startup; generation fails closed when R2 or `RUNPOD_COMFY_WEBHOOK` is unavailable.

## 2. Operating owner model

| Role | Accountability |
|---|---|
| Primary launch operator | Runs safe checks, opens the sanitized incident record, classifies, contains, coordinates authorization, and closes/escalates. |
| Engineering/repository escalation | Diagnoses source, CI, build, deployment, application, database-client, and API contract failures; proposes the smallest reviewed recovery. |
| Security/privacy escalation | Owns suspected authorization, RLS, secret, personal-data, protected-admin, or evidence-exposure incidents. |
| Payment/financial escalation | Owns Payment V2, Stripe, entitlement, reconciliation, affiliate-ledger, and money-impact decisions. |
| Creator-publishing/provider escalation | Owns CPQ scheduler, operator queue, Fanvue finite outcomes, and provider/OAuth decisions. |

Repository evidence does not identify distinct people for these roles or establish an on-call team. Before public opening, the accountable operator must record who accepts each role; roles may be held by the same authorized person.

## 3. Finite severity model

- **P0 — critical:** suspected secret/private-data exposure, authorization/RLS/protected-admin breach, unsafe financial duplication, or launch-wide critical failure. Trigger on one credible occurrence; contain immediately and escalate to security/privacy plus the subsystem owner.
- **P1 — major:** sustained public/auth/API failure, payment state cannot be trusted, scheduler stops, or a launch-critical job is retry-exhausted. Trigger on one confirmed security/payment-integrity state, one retry-exhausted job, two consecutive safe checks failing five minutes apart, or a deployment marked failed.
- **P2 — degraded:** bounded subsystem failure with a safe fallback/manual queue and no evidence of integrity loss. Trigger on a finite failure or repeated non-success that remains contained.
- **P3 — warning:** maintenance/configuration warning with no current customer or integrity impact. Review at the next manual cadence.

These are operational triggers, not externally guaranteed SLAs. When evidence is incomplete, classify upward until confidentiality and integrity are excluded.

## 4. Signal / owner / recovery matrix

Mechanisms are finite: **AUTOMATED**, **MANUAL OPERATOR CHECK**, **CI / DEPLOYMENT GATE**, and **NOT CONFIGURED**. `AUTOMATED` means an existing runtime/scheduler produces the signal; it does not mean a human notification platform exists. No repository evidence establishes a universal automated paging/monitoring platform.

Abbreviations: **PLO** primary launch operator; **ENG** engineering; **SEC** security/privacy; **PAY** payment/financial; **CPP** creator-publishing/provider. All evidence is internal operational data unless marked security or financial; apply §5 redaction.

| Subsystem / signal | Source; healthy → failure | Sev.; trigger; mechanism | Owner; first response / escalation | Safe verification; recovery reference |
|---|---|---|---|---|
| Vercel Production deployment failure | Vercel deployment status; `READY`, target/ref/SHA match → failed/canceled/mismatch | P1; one failed intended deployment; CI / DEPLOYMENT GATE | PLO→ENG; freeze promotion, preserve deployment ID/SHA; escalate if current serving deployment is affected | Read-only deployment metadata and alias/public response separately; Vercel deployment history, §9 |
| Frontend build/CI failure | hosted workflow/build logs; all required jobs pass → any required job fails | P1 before release/P2 on non-release PR; one failure; CI / DEPLOYMENT GATE | ENG; block merge/promotion and reproduce safely | `npm run build`, focused tests; failing workflow/job |
| Public site 5xx or route failure | safe GET/HEAD and Vercel logs; expected 2xx/3xx → 5xx/wrong route | P1; two checks five minutes apart or multiple critical routes; MANUAL OPERATOR CHECK | PLO→ENG; keep dark launch/stop opening | Public non-mutating request; public-path test, §9 |
| Auth/session failure | Supabase auth responses and bounded app errors; valid session resolves → systemic login/session rejection | P1; two safe synthetic/operator checks; MANUAL OPERATOR CHECK | PLO→ENG; preserve status/request ID, exclude credentials; SEC if token exposure suspected | Non-mutating login-page/session source review; `proxy.ts`, frontend readiness contract |
| Authorization regression | route/page contract; unauthenticated/unauthorized access denied → protected content accessible | P0; one credible occurrence; CI / DEPLOYMENT GATE plus MANUAL OPERATOR CHECK | SEC; restrict access without mutating data, preserve sanitized evidence | source tests and non-mutating unauthorized request only; API authorization inventory |
| Supabase unavailable/query failure | bounded route/SDK errors; expected query succeeds → dependency/query failure | P1 systemic/P2 bounded; two checks or one integrity-sensitive failure; MANUAL OPERATOR CHECK | PLO→ENG; stop affected writes/workflow | bounded readiness/UI state, no SQL; subsystem runbook and §9 |
| RLS/security regression | audit/test/migration review; policies and grants remain constrained → unexpected access/grant | P0; one test/audit failure; CI / DEPLOYMENT GATE | SEC→ENG; block release and preserve diff | static/migration tests or separately authorized read-only audit; security inventory |
| Payment V2 configuration readiness | `/api/payment-v2/readiness`; ready state → fail-closed/unavailable | P1 before sales; one failed pre-opening check; MANUAL OPERATOR CHECK | PAY; keep Checkout closed, no Stripe probe | read-only readiness response; Payment V2 readiness tests/docs |
| Checkout application failure | finite Checkout V2 response; session handoff succeeds → bounded 4xx/5xx/error code | P1 systemic/P2 isolated; two sanitized reports, no probe purchase; MANUAL OPERATOR CHECK | PAY→ENG; do not retry uncertain financial outcome | source/contract tests only; `docs/incidents/2026-07-checkout-recovery.md` |
| Webhook signature failure | webhook finite status/log; valid signed event accepted → signature rejection | P1 if legitimate delivery/P2 isolated noise; one legitimate provider-dashboard failure; AUTOMATED (response), notification NOT CONFIGURED | PAY→SEC if secret compromise suspected; do not replay blindly | provider dashboard metadata only, no body/secret; Payment V2 webhook tests |
| Webhook processing/replay failure | inbox/event states and finite errors; idempotent processed/replay → terminal/uncertain state | P1; one integrity-uncertain or repeated legitimate event; AUTOMATED (persistence), notification NOT CONFIGURED | PAY→ENG; freeze affected entitlement action | sanitized event/request IDs and read-only operator evidence; Payment V2 recovery docs |
| Claim/entitlement failure | claim lifecycle and authoritative subscription read; single grant/read succeeds → conflict/unavailable/mismatch | P1; one paid claimant blocked or duplicate suspicion; MANUAL OPERATOR CHECK | PAY→ENG; do not manually grant | finite code/state and source test; claim/readiness contracts |
| Payment reconciliation mismatch | reconciliation evidence/readiness; provider/app states agree → mismatch/unknown | P0 duplication/data integrity, otherwise P1; one mismatch; MANUAL OPERATOR CHECK | PAY; suspend affected action, preserve IDs | read-only sanitized reconciliation; checkout recovery incident doc |
| Affiliate ledger/reconciliation anomaly | immutable attribution/ledger summaries; balanced finite lifecycle → duplicate/missing obligation | P1 financial integrity/P2 bounded; one duplicate or batch mismatch; MANUAL OPERATOR CHECK | PAY→ENG; stop payout execution | read-only summaries/tests; affiliate contract/reconciliation controls |
| CPQ scheduler not running/invocation failure | canonical cron history and `/api/creator-publishing-queue/fanvue/run` finite response; periodic HTTP 200 → absent/non-success | P1; two expected invocations missing/non-success; AUTOMATED invocation, notification NOT CONFIGURED | CPP→ENG; prevent blind catch-up | read-only cron history/HTTP metadata; Fanvue activation runbook |
| CPQ job retry-exhausted | CPQ job/attempt states and finite code; progresses or safely retries → terminal exhausted | P1; one launch-critical job; AUTOMATED persistence, notification NOT CONFIGURED | CPP; place in manual recovery, no provider retry | read-only operator queue; Task 21 operations |
| CPQ operator queue requires recovery | operator queue finite states; no overdue actionable item → blocked/action required | P2, P1 if launch-critical deadline; one item at threshold; MANUAL OPERATOR CHECK | CPP; claim only under runbook authorization | read-only queue UI/state; Task 21 operations |
| Fanvue worker/provider finite failure | worker `ok/code` and safe finite provider outcome; completed → blocked/retryable/terminal/uncertain | P1 uncertain/terminal, P2 bounded retryable; one uncertain/exhausted; AUTOMATED persistence, notification NOT CONFIGURED | CPP; stop blind retry; ENG if source defect | sanitized code/status/retry count only; Fanvue ADR/worker contracts |
| Fanvue scheduler HTTP non-success | scheduler route status and `CRON_SECRET_NOT_CONFIGURED`, disabled, unauthorized, worker failed; HTTP 200 → non-success | P1; two scheduled non-successes, immediate if auth config missing; AUTOMATED response, notification NOT CONFIGURED | CPP→ENG/SEC for unauthorized pattern | cron metadata without header; activation/deactivation runbook |
| Generation application execution-disabled | `GENERATION_EXECUTION_ENABLED` gate and `GENERATION_UNAVAILABLE`; disabled is expected while budget hold remains | P3 expected; unexpected enablement is P0; MANUAL OPERATOR CHECK plus CI / DEPLOYMENT GATE | ENG/SEC on unexpected enablement; keep fail closed | source/config-name posture only, no generation request; generation contracts |
| Generation proxy/API unavailable | frontend proxy finite 5xx; route/config available while compute intentionally off → proxy/Railway failure | P2 while compute budget-disabled/P1 when separately activated; one bounded check; MANUAL OPERATOR CHECK | ENG; distinguish application from pods | source tests/read-only deployment status, no generated output; §8 |
| Railway API deployment/runtime failure | Railway metadata/logs and business-route bounded responses; current deployment `SUCCESS` at audited SHA → failed/unavailable/SHA mismatch | P1 when application required; two checks/deployment failure; MANUAL OPERATOR CHECK / deployment gate external to this repo | PLO→ENG; preserve deployment/SHA | read-only Railway metadata; API repo tests/runbook; never infer compute health from deployment success |
| API internal auth not configured | centralized fail-closed predicate/config error; configured secret → startup/request fails closed | P1; one config failure; AUTOMATED response, notification NOT CONFIGURED | ENG→SEC; keep privileged ingress closed | API source/unit tests; API authorization inventory; no health endpoint assumed |
| API unauthorized privileged ingress | centralized auth 401/403; authorized internal request only → denial/attack pattern or unauthorized success | P0 if unauthorized success, P2 for isolated rejected attempt; one success or repeated denials; AUTOMATED response, notification NOT CONFIGURED | SEC→ENG; contain ingress | sanitized status/route/request ID; API authorization inventory |
| Dataset Doctor API failure | API finite response/runtime logs; validated operation completes → bounded 4xx/5xx | P2 while generation budget-disabled/P1 when training authorized; one failure; MANUAL OPERATOR CHECK | ENG; keep training disabled | API source/unit tests only; no real dataset/generation |
| Public/legal route regression | public-path matrix; intended anonymous routes render → missing/redirect/protected/5xx | P1 before opening/P2 dark launch; one CI failure or two checks; CI / DEPLOYMENT GATE plus MANUAL OPERATOR CHECK | PLO→ENG | `npm run test:public-paths`, safe GET/HEAD after deployment |
| Protected Production admin integrity | operator-supplied one-admin boundary; unchanged sole admin → deletion/role/ownership anomaly | P0; one credible anomaly; MANUAL OPERATOR CHECK | SEC; stop all admin-affecting action | separately authorized read-only evidence only; roadmap row 50 |

## 5. Sanitization and redaction standard

Use the literal token **`[REDACTED]`** consistently. Never log, paste, screenshot, or copy into an incident record: passwords; Supabase service-role keys; database passwords; Stripe secret keys or webhook secret; full payment instrument data; Fanvue OAuth/access/refresh tokens or reconnect secret; `CRON_SECRET`; API internal secret; cookies/session tokens; `Authorization` headers; private encryption keys; Vault secret values; unnecessary customer/user content or personal information; or raw sensitive complaint/removal evidence.

Permitted only when operationally necessary: internal case/job IDs, sanitized request IDs, route, finite error code, HTTP status, UTC timestamp, deployment ID, commit SHA, redacted provider/account identifier, and retry count. Store restricted evidence by reference, minimize it, and redact query strings and provider payloads. If a secret appears, do not repeat it: replace it with `[REDACTED]`, restrict the record, and escalate to SEC for separately authorized rotation.

Focused frontend and API source review found bounded/sanitized logging plus operational metadata that can include identity-LoRA identifiers, R2 object/path information, filenames, bounded exception details, raw error objects, or upstream response excerpts. No credential/secret value was proven to be logged, so neither repository was speculatively refactored. Treat those operational identifiers and details as restricted evidence. Operators must inspect and redact raw errors and upstream excerpts before copying them into an incident record; never copy them wholesale.

## 6. Payment V2 observability — LOCKED / FROZEN / GTG

Observe readiness, finite Checkout errors, webhook signature/inbox/replay states, claim/entitlement states, and reconciliation evidence. Reference existing tests and recovery material; do not alter semantics. Do not create Checkout, charge, refund, call Stripe as a probe, change bank information/configuration, or treat the future real-money canary as complete. That canary remains **DEFERRED — BUDGET**.

## 7. CPQ / Fanvue observability — frozen

CPQ is canonical. Observe scheduler HTTP metadata, cron history, finite scheduler/worker codes, jobs/attempts, retry exhaustion, and the operator queue. Fanvue execution remains frozen: no proof post, provider call, fake/real job, OAuth reconnect/revoke/refresh, configuration change, SQL, or deactivation. The deactivation document is decision support, not authorization to execute.

## 8. Generation and separate API observability

**Application health is not real compute availability.** Pods remain intentionally OFF for budget reasons; pod-off is not an incident. Real generation/training failure cannot be exercised, and mock/fake output is never proof. Check only the application gate, fail-closed configuration, route/proxy error handling, Railway deployment/runtime metadata, and internal-ingress auth. Starting a pod or enabling execution requires separate authorization.

The frontend exposes bounded `/api/health`, `/api/status`, `/api/ping`, and `/api/generate/availability` surfaces. They do not prove Railway or compute health. The current API audit at `2c84f8620dc626a449740b6e946fef1388605cee` confirms the business/framework route and centralized-auth contracts and confirms that **no custom API health/readiness endpoint exists**.

## 9. Recovery decision model and authorization

For every P0/P1: **DETECT → CLASSIFY → CONTAIN → PRESERVE EVIDENCE → CHOOSE RECOVERY → OBTAIN REQUIRED AUTHORIZATION → EXECUTE ONLY IF AUTHORIZED → VERIFY → DOCUMENT → CLOSE / ESCALATE**.

Separate explicit authorization is mandatory for every Production database write; SQL/migration; Supabase mutation; Vercel environment change; deployment promotion/rollback; Stripe action; provider/OAuth action; scheduler mutation; generation/pod start; protected-admin change; or Railway Production change. A proposed command is not authorization. Prefer fail-closed containment and read-only verification.

Recovery references:

- Payment V2: `docs/incidents/2026-07-checkout-recovery.md`, Payment V2 readiness route/tests, and roadmap rows 18–24.
- CPQ/manual recovery: `docs/creator-publishing/task21-onlyfans-reliability-operations.md`.
- Fanvue scheduler: `docs/autopost/fanvue-cpq-scheduler-activation-runbook.md` (activation/deactivation; do not execute without authorization) and `docs/autopost/fanvue-launch-architecture-decision.md`.
- Authorization: `docs/security/api-authorization-inventory.md` and frontend launch-readiness/public-path tests.
- Sensitive complaints/removal overlap: `docs/operations/complaints-removal-operations.md`.

## 10. Zero-cost manual cadence

The PLO performs and records safe, read-only checks: (1) CI/build and exact deployment/ref/SHA plus aliases/public responses separately after every authorized Production deployment; (2) public/legal, auth shell, Payment readiness, scheduler metadata, operator queue, and Railway metadata before opening public access; (3) the same critical dashboards once daily during dark launch/launch week when a named operator is available; and (4) immediate triage when a finite error, reconciliation mismatch, unauthorized-success signal, or retry threshold appears. This cadence does not promise 24/7 coverage. Missing ownership itself blocks public opening.

## 11. Sanitized incident record template

```text
Incident ID:
UTC opened time:
Subsystem / severity (P0-P3):
Triggering signal:
Sanitized evidence (use [REDACTED]; never secrets):
Commit SHA / deployment ID:
Affected route / state / finite error code / HTTP status:
Containment:
Authorization required (yes/no; authority and scope, never credential):
Action taken (or "none"):
Safe verification:
Escalation and accountable role:
UTC closed time:
Follow-up / owner:
```

## 12. Safe synthetic tabletops

All scenarios use invented IDs and statuses only—no customer data, provider calls, payment, generation, Production mutation, SQL, or OAuth action.

| Scenario / synthetic signal | Sev.; owner; sanitization | Containment / reference / authorization | Safe verification / closure |
|---|---|---|---|
| **A. Vercel Production deployment fails** (`dpl_SYNTH`, failed) | P1; PLO→ENG; ID/SHA/status only | Block promotion; Vercel history/§9; rollback/promotion requires approval | Read-only metadata; close when intended deployment and aliases/public responses are separately verified |
| **B. Public site returns 5xx** (two synthetic checks) | P1; PLO→ENG; route/status/request ID | Keep dark launch; public-path contract; deploy/rollback requires approval | Local test plus non-mutating GET; close after consecutive healthy checks and cause recorded |
| **C. Supabase/auth unavailable** (`DEPENDENCY_UNAVAILABLE`) | P1; ENG; no cookie/header/user data | Fail closed; auth/subscription contracts; Supabase/env/data action requires approval | Source tests and safe UI state; close when dependency and authorization boundaries verify |
| **D. Payment webhook/reconciliation anomaly** (`evt_[REDACTED]`, mismatch) | P1/P0 if duplication; PAY; no body/secret/payment data | Stop affected entitlement/financial action; checkout recovery doc; Stripe/DB action requires approval | Contract/readiness evidence; close only when states reconcile without duplicate effect |
| **E. CPQ scheduler stops invoking** (two missing ticks) | P1; CPP; cron name/timestamps only | No catch-up/provider call; scheduler runbook; scheduler/SQL change requires approval | Read-only cron metadata; close after expected invocations resume and queue is assessed |
| **F. CPQ job retry-exhausted** (`job_SYNTH`, count=max) | P1; CPP; job ID/code/count | Manual queue, no retry; Task 21; queue/provider/DB action requires approval | Source/operator-queue contract; close after authorized finite disposition is evidenced |
| **G. Fanvue finite provider failure** (`FANVUE_CPQ_WORKER_FAILED`) | P1 uncertain/P2 bounded; CPP; code/status only | Stop blind retry; Fanvue ADR; every provider/OAuth action requires approval | Unit/source contract; close when finite disposition is recorded, never by live probe |
| **H. Railway API unavailable** (two synthetic 503s) | P1; PLO→ENG; route/status/deployment/SHA | Keep dependent generation disabled; Railway/API docs; deploy/env change requires approval | Read-only Railway metadata/API tests; close after runtime and exact SHA verify |
| **I. API internal auth not configured** (`INTERNAL_AUTH_NOT_CONFIGURED`) | P1; ENG→SEC; never secret/header | Preserve fail-closed state; API inventory; env/deployment change requires approval | API auth test/source inspection; close when config presence and unauthorized rejection verify without revealing value |
| **J. Generation request meets intentionally disabled compute** (`GENERATION_UNAVAILABLE`) | P3 expected; ENG; route/code only | Keep disabled; §8; pod/env start requires approval | Source test only; close as expected while budget hold is documented; no mock/real output |
| **K. Public/legal route regression** (synthetic `/privacy` wrong status) | P1 pre-open/P2 dark launch; PLO→ENG | Block opening; public-path contract; deploy requires approval | `npm run test:public-paths`; close when intended matrix passes |
| **L. Suspected authorization/RLS regression** (synthetic unauthorized success) | P0; SEC→ENG; no row/user/credential | Restrict access and preserve minimal evidence; security inventory; DB/RLS/admin/deploy action requires approval | Static tests or separately authorized read-only audit; close only after unauthorized access is disproved/fixed and reverified |

## 13. Closure record

Row 48 is **DONE**. The launch-wide matrix, roles, severity/threshold model, truthful alert mechanisms, sanitization standard, recovery references, cadence, incident template, tabletops, frontend source review, and current API read-only audit are complete. The API repository was not modified. No source-level launch observability/recovery blocker remains; maintenance means keeping the matrix and regression contract aligned when routes/signals change, performing the documented safe checks, and separately authorizing every real recovery mutation. `OPEN = 0` does not complete or reclassify any budget, dependency, or post-launch gate.
