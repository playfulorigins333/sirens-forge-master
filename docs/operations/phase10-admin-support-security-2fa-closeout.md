# Phase 10 — Admin, support, security, and 2FA closeout

## Status

**Phase 10 is complete for the approved launch scope.**

The Phase 10 admin/support/security/2FA foundation is merged, deployed to Production, Production migrations are applied, and the implemented human-admin and support workflows have been verified end-to-end in Production.

Two higher-risk capabilities remain deliberately unavailable and fail closed:

1. controlled admin access to creator private media; and
2. automated MFA recovery.

These are **deferred capabilities, not Phase 10 launch blockers**. They must not be implemented by weakening current privacy or MFA boundaries. Any future work on either capability requires its own approved security/privacy contract and change set.

## Implemented architecture

Phase 10 uses forward-only migrations `20260906070000_phase10_admin_support_security.sql` and `20260906093000_phase10_support_resolution_message.sql`. Three deliberately small roles (`founder_admin`, `support_operator`, and `security_operator`) map to finite governance/support capabilities. Assignments have activation and revocation timestamps. The database is authoritative: no email, profile flag, client metadata, or request-supplied actor establishes authority. Authority/support tables use forced RLS and bounded RPCs.

The Phase 10 authority migration bootstraps exactly one active `founder_admin` from the valid Auth user referenced by the sole `sole_production_admin_guard`. It aborts on zero, multiple, or invalid matching subjects and contains no identity constant. The stable `governance_actor_is_founder_admin(uuid)` signature delegates to active Phase 10 membership, preserving the Phase 8 legal-hold database boundary.

Human admin authorization is centralized in `lib/security/adminAuthorization.ts`. It gets identity only from the verified Supabase server session, requires the existing fresh-TOTP/AAL2 contract, and then invokes a bounded database capability check. Legal-hold HTTP routes require `governance.legal_hold.manage`; the Phase 8 database lifecycle still independently requires Founder/Admin authority.

Governance audit reads require `governance.audit.read`, use sequence pagination and finite exact filters, and return only minimized event metadata. Each successful privileged read appends a separate minimized `governance.audit.read` audit event after selecting the page, avoiding recursive inclusion in the page being returned. Non-founder privileged staff are truthfully represented by the Phase 10 `admin_operator` audit actor type; Founder/Admin retains its existing semantic.

## Support operations

Support cases use finite category/state/priority values, bounded sanitized summaries, creator ownership, and a conservative state graph. Creator and admin queue pagination use a complete timestamp + UUID composite cursor so equal timestamps cannot skip rows.

Support cases are working/support data, not immutable compliance evidence. They use deletion-safe Auth relationships: creator case rows cascade with final Auth deletion, assignee/activity actor references are nullable on Auth deletion, and role assignments cascade. Durable governance audit evidence deliberately has no Auth FK and therefore survives final Auth deletion. The existing `sole_production_admin_guard` continues protecting the Founder/Admin Auth row.

Support transitions are capability-gated and append governance evidence. A `support_operator` is not mislabeled as `founder_admin`; Phase 10 records truthful `admin_operator` audit evidence while keeping legal-hold authority Founder/Admin-only.

The support resolution hotfix requires a creator-facing resolution message when a case is resolved. That message is stored with the case/support activity and returned only through the creator-owned support listing flow. The creator UI renders the resolution under `What we did`. Reopening a resolved case clears stale `resolved_at` and creator-visible resolution text.

### Production support verification

The Production support workflow was verified end-to-end using normal application surfaces:

- creator opened a support case from `/account/support`;
- protected admin queue at `/admin/support` displayed the case;
- Founder/Admin transitioned the case from `open` to `in_progress`;
- governance evidence recorded the status transition truthfully as `founder_admin`;
- admin resolution required a creator-facing message;
- the case resolved with `resolved_at` set;
- the creator-facing support page displayed the exact resolution message under `What we did`.

The pre-hotfix test case remains a valid legacy resolved case without a resolution message because it was resolved before the hotfix existed.

## Controlled private-content access — deferred and fail closed

The `support.private_access.authorize` capability remains reserved, but no private-media support delivery endpoint is enabled. Current private-media delivery remains creator-owner-bound.

Phase 10 intentionally does **not** introduce a service-role media bypass, blanket support browsing, or a support-access shortcut. A future private-content troubleshooting capability must be case-bound, short-lived, creator-appropriate, receipt-first, and auditable before any media access is issued.

Until that separate contract exists and is approved, admin/support private-media access remains unavailable by design.

## Security and MFA

Creator MFA remains opt-in. Existing enrolled-creator challenge behavior, factor ownership controls, safe redirects, verified-factor removal boundary, ten-minute TOTP freshness, and five-second future allowance remain unchanged.

Every new human-admin API/page uses the shared fresh-TOTP posture plus a database capability check. No SMS recovery, recovery codes, impersonation, password-reset shortcut, MFA-disable action, or bypass is introduced by Phase 10.

`security_operator` receives the existing minimized governance audit-read capability rather than a speculative duplicate security-events store. No separate unused `security.events.read` capability is required.

### Production human-admin verification

Production verification confirmed:

- a fresh TOTP authenticator can be enrolled through the existing account-security flow;
- `/admin/governance` redirects through the MFA freshness boundary when needed;
- a fresh verified TOTP session plus Founder/Admin capability permits the protected governance page;
- a successful governance audit read self-records `governance.audit.read` evidence;
- `/admin/support` is protected by the same human-admin MFA/capability boundary.

## Automated MFA recovery — deferred and fail closed

Automated MFA recovery remains unavailable until an authoritative identity-proofing and approval policy exists.

Phase 10 intentionally does **not** add an administrator backdoor for removing a user's MFA factor, impersonating the user, resetting MFA without proof, or bypassing fresh-TOTP controls. Existing verified-factor removal behavior remains the safe boundary.

Any future MFA recovery workflow requires its own approved identity-proofing, authorization, audit, abuse-prevention, and recovery policy before engineering begins.

## PostgreSQL and CI verification

Phase 10 includes a disposable PostgreSQL 17 integration runner and dedicated pull-request workflow. The suite verifies Founder/Admin bootstrap, capability separation, support-operator behavior, RLS/privileges, audited governance reads, composite pagination with equal timestamps, resolved/reopen state, deletion compatibility, durable audit evidence, the existing sole-admin deletion guard, and creator-visible resolution-message behavior.

The Phase 10 pull-request gate also runs source-contract tests, the API authorization inventory contract, Phase 9 regression coverage, and the application build.

The final support-resolution hotfix passed all of those gates before merge.

## Production deployment and migration state

The Phase 10 foundation was merged by PR #360 and the creator-visible support-resolution hotfix by PR #361.

Production Vercel is deployed from `main` with the merged Phase 10 hotfix commit `26d5cade5de6aa8adba4adf8f0e6635b10d50bb6` and reached `READY`.

Production Supabase has both Phase 10 changes applied:

- `20260906070000_phase10_admin_support_security.sql` — applied through the Supabase migration API and recorded by the Production ledger as application version `20260906085228`;
- `20260906093000_phase10_support_resolution_message.sql` — applied through the Supabase migration API and recorded by the Production ledger as application version `20260906092813`.

The application-timestamp ledger versions differ from repository filename timestamps because the migration API records its own application time. The SQL applied was the exact merged repository migration content.

## Phase boundary

Phase 9 behavior remains unchanged and verified. Phase 11 has not been started by this closeout. Phase 12 billing/Stripe is unchanged. Phase 13 publishing/provider behavior is unchanged. No live provider execution is authorized by this document. Historical migrations remain unchanged.

The locked sequence remains:

- Phase 10 — Admin / support / security / 2FA — **COMPLETE**;
- Phase 11 — Legal / privacy / AUP / safety / age / NCII / IP — **next phase**.

## Final closeout decision

**Phase 10 is closed.**

Launch-scope admin authority, governance access, support operations, security visibility, human-admin fresh-TOTP enforcement, audit evidence, and creator-visible support resolution messaging are implemented, deployed, migrated, tested, and Production-verified.

Controlled admin private-media access and automated MFA recovery remain deliberately deferred and fail closed until separately approved security/privacy contracts exist. Their absence does not block Phase 10 closeout and must not be used as justification for weakening current privacy or MFA safeguards.
