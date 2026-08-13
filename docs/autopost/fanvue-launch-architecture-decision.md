# Fanvue Launch Architecture Decision Record

- **Status:** Accepted
- **Scope:** Fanvue launch architecture lock; documentation only
- **Baseline:** `cb38febdafce1116195f3a4900f9b8c63e8318e4`

## Context

Fanvue is the automated publishing platform for launch, but creator-facing Fanvue publishing is not currently end-to-end. Creator Publishing Queue (CPQ) contains the newest creator workflow and state model, while the proven Fanvue provider primitives live under `lib/autopost`. Those systems are disconnected. The older `autopost_rules`/`autopost_jobs` state machine and admin Fanvue routes contain compatibility, diagnostic, and controlled-proof behavior; they are not a public launch architecture.

This decision prevents a third state machine, preserves the current freeze, and fixes ownership before implementation begins.

## Decision

### Architecture ownership

CPQ is the authoritative state machine for launch Fanvue publishing. It owns creator identity, destination ownership/reference, content packages, generated-media associations, compliance and consent, creator approval, publishing plans, schedules, publication jobs and attempts, success/failure state, retry eligibility, and creator-visible history.

`autopost_rules`, `autopost_jobs`, `app/api/autopost/rules/**`, and legacy `/api/autopost/run` Fanvue bridges are not authoritative launch state. They may remain temporarily for compatibility or diagnostics, but new public Fanvue product work must not be built on them. No third publishing state machine will be created.

Reusable provider core from `lib/autopost` may be extracted or wrapped for CPQ, including the API client, token crypto and refresh, identity lookup, upload sessions, signed-part upload, finalize, media readiness, text/media post creation, and safe provider-result normalization.

The routes and proof infrastructure under `app/api/admin/autopost/fanvue/**` must remain isolated. Controlled routes, confirmation strings, admin allowlists, diagnostic secrets, canary assets, dry-run bridges, and proof-only endpoints must not be exposed or repurposed as creator execution endpoints. Core may be shared; diagnostic/admin routes may not.

The OAuth credential model (`autopost_accounts`) and CPQ destination-reference model (`creator_platform_accounts`) must not remain ambiguous or disconnected at launch. A dedicated later gate must establish their authoritative ownership and provider-identity relationship; this ADR does not choose or implement that schema.

### Scheduling decision

Launch scheduling is **Sirens Forge application-timed execution**:

1. A creator schedule creates CPQ plan/job state.
2. A CPQ scheduler event becomes due.
3. A server-owned worker claims the executable Fanvue job.
4. The worker revalidates every launch requirement.
5. The worker invokes an immediate Fanvue provider post.
6. Trusted provider proof or a classified failure is persisted.
7. CPQ job and schedule state advances only from durable trusted proof.

Fanvue provider-native `publishAt` is not a launch dependency. The low-level capability exists, but it is not used by the proven adapter and its availability and reliability for the intended creator/app tier are unproven. Provider-native scheduling may be evaluated later as a separate optimization.

### Security and entitlement boundaries

Provider execution is server-owned. Browser/client code must never directly perform Fanvue posting or supply authoritative execution facts. The worker resolves and verifies server-side the entitled creator, destination account, provider identity, package, media, schedule, job, attempt identity, ownership, token, and provider payload. Client-supplied creator IDs, ownership, subscription state, provider UUIDs, proof, or execution state are never authoritative.

Creator-facing Fanvue access reuses `ensureActiveSubscription()`. Only `active` and `trialing` are entitled. `canceled`, `past_due`, `unpaid`, `paused`, `incomplete`, `incomplete_expired`, and no subscription are not entitled. The worker must revalidate entitlement immediately before provider execution. No second entitlement system will be introduced.

### Retry, idempotency, and uncertain outcomes

CPQ retry states alone do not make a Fanvue retry safe. Execution must distinguish:

- confirmed failure;
- authentication failure;
- permanent provider rejection;
- transient failure known not to have created a post;
- uncertain provider outcome; and
- confirmed provider success.

An uncertain outcome—for example, Fanvue accepts a post but Sirens Forge loses the response before proof is persisted—must not be blindly retried. Automated retry requires either proven Fanvue provider idempotency or reliable reconciliation proving whether the original operation created a post. Without one of those guarantees, uncertain outcomes fail closed for manual recovery.

### Provider proof requirement

A worker attempt, returned HTTP response, completed local job, or completed media upload is not publication success. Success requires trusted provider proof, including the provider post identifier/UUID required by the final execution contract. Schedule completion or advancement occurs only after durable successful provider proof.

### Current freeze

This ADR does not enable Fanvue. Until later gates are complete:

- existing frozen/non-selectable posture remains;
- creators cannot directly publish or execute Fanvue schedules;
- CPQ cannot create runnable Fanvue jobs;
- no new cron is activated; and
- no Production feature flag is activated.

Freeze removal is the final enablement gate, not the first implementation step.

### Platform roadmap

- **Fanvue:** automated publishing launch platform and active engineering path.
- **OnlyFans:** assisted/manual; final live verification is parked pending a genuinely verified creator account.
- **X:** Coming Soon; funding/provider-access gated, non-selectable, and non-schedulable.
- **Reddit:** Coming Soon; funding/provider-access gated, non-selectable, and non-schedulable.

### Generation boundary

Fanvue publishing consumes already-approved Sirens Forge content and media state. Source and security development must not depend on generation pods being online. Generation, RunPod, and ComfyUI architecture is outside this publishing gate.

## Consequences

- CPQ must be extended rather than bypassed for creator-facing Fanvue work.
- Existing Fanvue provider primitives can reduce duplication, but require a CPQ-oriented server execution contract.
- Legacy and diagnostic state may coexist temporarily but cannot determine creator publication truth.
- Account ownership, attempt/proof persistence, uncertain outcomes, and execution-time entitlement must be solved before runnable jobs or automatic retries.
- Public enablement remains deliberately last.

## Non-goals

This ADR does not change runtime behavior, schemas, migrations, tests, routes, workers, cron configuration, environments, Production, OAuth connections, provider scopes, or platform availability. It does not delete legacy code, design the account-link schema, enable retries, call Fanvue, alter OnlyFans, reopen X or Reddit, or change generation infrastructure.

## Ordered implementation gates

The following sequence is directional and each gate remains independently reviewable:

1. Reconcile stale Fanvue source-contract tests.
2. Add the paid Fanvue OAuth boundary.
3. Establish the canonical OAuth-account ↔ CPQ destination ownership bridge.
4. Enable CPQ Fanvue accounts/packages while keeping them non-runnable.
5. Extract a CPQ-oriented Fanvue executor.
6. Establish provider scope/capability readiness.
7. Add direct Fanvue job/attempt schema through a forward-only migration.
8. Establish duplicate/idempotency/uncertain-outcome safety.
9. Add the server-owned immediate-publish worker.
10. Add the bounded retry/reconnect state machine.
11. Integrate CPQ application-timed scheduling.
12. Add creator-owned status/history.
13. Prepare cron activation and operational controls.
14. Perform final public Fanvue enablement.
15. Perform separately authorized live provider verification as needed.
