# Phase 10 — Admin, support, security, and 2FA closeout

## Implemented architecture

Phase 10 adds forward-only migration `20260906070000_phase10_admin_support_security.sql`, intentionally versioned after the currently applied Production Phase 9 ledger. Three deliberately small roles (`founder_admin`, `support_operator`, and `security_operator`) map to finite governance/support capabilities. Assignments have activation and revocation timestamps. The database is authoritative: no email, profile flag, client metadata, or request-supplied actor establishes authority. Authority/support tables use forced RLS and bounded RPCs.

The migration bootstraps exactly one active `founder_admin` from the valid Auth user referenced by the sole `sole_production_admin_guard`. It aborts on zero, multiple, or invalid matching subjects and contains no identity constant. The stable `governance_actor_is_founder_admin(uuid)` signature delegates to active Phase 10 membership, preserving the Phase 8 legal-hold database boundary.

Human admin authorization is centralized in `lib/security/adminAuthorization.ts`. It gets identity only from the verified Supabase server session, requires the existing fresh-TOTP/AAL2 contract, and then invokes a bounded database capability check. Legal-hold HTTP routes require `governance.legal_hold.manage`; the Phase 8 database lifecycle still independently requires Founder/Admin authority.

Governance audit reads require `governance.audit.read`, use sequence pagination and finite exact filters, and return only minimized event metadata. Each successful privileged read appends a separate minimized `governance.audit.read` audit event after selecting the page, avoiding recursive inclusion in the page being returned. Non-founder privileged staff are truthfully represented by the Phase 10 `admin_operator` audit actor type; Founder/Admin retains its existing semantic.

## Support operations

Support cases use finite category/state/priority values, bounded sanitized summary/notes, creator ownership, and a conservative state graph. Creator and admin queue pagination use a complete timestamp + UUID composite cursor so equal timestamps cannot skip rows. Reopening a resolved case clears `resolved_at`.

Support cases are working/support data, not immutable compliance evidence. They use deletion-safe Auth relationships: creator case rows cascade with final Auth deletion, assignee/activity actor references are nullable on Auth deletion, and role assignments cascade. Durable governance audit evidence deliberately has no Auth FK and therefore survives final Auth deletion. The existing `sole_production_admin_guard` continues protecting the Founder/Admin Auth row.

Support transitions are capability-gated and append governance evidence. A `support_operator` is not mislabeled as `founder_admin`; Phase 10 records truthful `admin_operator` audit evidence while keeping legal-hold authority Founder/Admin-only.

### Controlled private-content access blocker

The `support.private_access.authorize` capability is reserved, but no private-media delivery endpoint is added. The repository still lacks a case-bound, receipt-first, short-lived read primitive that can atomically create `admin_private_content_access` evidence before issuing access. Inventing a service-role storage bypass would violate the privacy boundary. This remains intentionally blocked.

## Security and MFA

Creator MFA remains opt-in. Existing enrolled-creator challenge behavior, factor ownership controls, safe redirects, verified-factor removal boundary, ten-minute TOTP freshness, and five-second future allowance remain unchanged. Every new human admin API/page uses the shared fresh-TOTP posture plus database capability. No SMS, recovery codes, impersonation, password reset, MFA-disable action, or bypass is introduced.

`security_operator` receives the existing minimized governance audit-read capability rather than a speculative duplicate security-events store. No separate unused `security.events.read` capability remains.

Automated MFA recovery remains blocked on an authoritative identity-proofing and approval policy. No automated recovery action exists in this phase.

## PostgreSQL verification

Phase 10 now includes a disposable PostgreSQL 17 integration runner and dedicated pull-request workflow. The suite applies the Phase 8 governance foundation and the Phase 10 migration, then verifies founder bootstrap, capability separation, support-operator behavior, RLS/privileges, audited governance reads, composite pagination with equal timestamps, resolved/reopen state, deletion compatibility, durable audit evidence, and the existing sole-admin deletion guard.

The Codex sandbox itself did not have local PostgreSQL; GitHub Actions is the authoritative execution environment for this new integration suite after this branch update.

## Phase boundary and status

Production migration is **not applied** by this PR and no Production data is mutated. Phase 9 behavior is unchanged. Phase 11 is not started. Phase 12 billing/Stripe is unchanged. Phase 13 publishing/provider behavior is unchanged. No live provider execution occurs. Historical migrations remain unchanged.

Phase 10 remains **partially engineering-complete** only for the two intentionally fail-closed items above: controlled private-media support access and automated MFA recovery require missing authoritative contracts. Independent admin authority, audited governance access, support operations, security visibility, and human-admin fresh-TOTP enforcement are implemented and covered by source/PostgreSQL CI.
