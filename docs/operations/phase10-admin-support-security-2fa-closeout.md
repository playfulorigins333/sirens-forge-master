# Phase 10 — Admin, support, security, and 2FA closeout

## Implemented architecture

Phase 10 adds a forward-only authority and support migration. Three deliberately small roles (`founder_admin`, `support_operator`, and `security_operator`) map to finite governance, support, private-access-authorization, and security-read capabilities. Assignments have activation and revocation timestamps. The database is authoritative: no email, profile flag, client metadata, or request-supplied actor establishes authority. All authority tables use forced RLS, have no direct browser or service-role table grants, and are consumed only through bounded functions.

The migration bootstraps exactly one active `founder_admin` assignment from the valid Auth user referenced by the sole `sole_production_admin_guard`. It aborts on zero, multiple, or invalid matching subjects, preserves the evidence row, and contains no identity constant. The stable `governance_actor_is_founder_admin(uuid)` signature now delegates to active Phase 10 membership, so Phase 8 legal-hold functions retain their independent database check.

Human admin authorization is centralized in `lib/security/adminAuthorization.ts`. It obtains the user only from a verified Supabase server session, requires verified TOTP at AAL2 with the existing ten-minute freshness/five-second future-skew contract, then invokes the bounded database capability check. It returns finite non-enumerating failures. The legal-hold HTTP route now requires `governance.legal_hold.manage`; its Phase 8 database lifecycle and authority checks remain unchanged.

The governance read RPC independently requires `governance.audit.read`, accepts only an exclusive sequence cursor, a 1–100 limit, and finite exact filters, and deterministically returns newest sequence first. It returns only event identity, actor type, action, target reference, time, reason category, result, and correlation ID—not facts, detailed reason, prompts, bodies, content, credentials, or hashes. The API and protected `/admin/governance` page require fresh TOTP and never directly select the audit table.

## Support operations

Support cases contain a creator ID, finite category/state/priority, a 3–500 character sanitized summary, optional assignee, and lifecycle timestamps. Append-only activities contain bounded notes and transition metadata; neither schema has prompt/media/token/secret/signed-URL fields. Creator RPCs derive `auth.uid()` and create/list only the caller's cases. Staff queue and transition RPCs independently enforce `support.case.read` or `support.case.manage`, bounded pagination, and a conservative transition graph. Important transitions append existing governance evidence. `/account/support` and `/admin/support` provide minimal accessible creator and staff workflows.

### Controlled private-content access blocker

The explicit `support.private_access.authorize` capability is reserved, but no private-media delivery endpoint was added. The repository does not provide a case-bound, receipt-first, short-lived read primitive that can atomically create the existing `admin_private_content_access` evidence before issuing access. Inventing a service-role storage bypass would violate the required boundary. A future implementation needs an approved media identifier contract and an atomic receipt/access-ticket primitive; it must not enable library browsing, mutation, or signed-URL persistence.

## Security and MFA

Creator MFA remains opt-in. Existing enrolled-creator challenge behavior, factor ownership controls, safe internal redirect validation, verified-factor removal boundary, ten-minute TOTP freshness, and five-second future allowance are unchanged. Every new human admin API and server-rendered admin page requires the shared fresh-TOTP posture plus a database capability. No SMS, recovery codes, impersonation, password reset, MFA-disable action, or bypass was introduced. Governance audit visibility supplies minimized security/admin operational evidence without creating a duplicate sensitive log.

Automated MFA recovery remains blocked on an authoritative identity-proofing and approval policy. The fail-closed operational boundary is: do not remove a factor or change account credentials for a requester; preserve sanitized case evidence; escalate for separately authorized identity verification and Supabase administrative procedure. No automated recovery action exists in this phase.

## Privileges and minimization

Every new table has RLS and FORCE RLS. `PUBLIC`, `anon`, `authenticated`, and `service_role` have no direct table privileges. Authenticated creators receive only the two ownership-bound support RPCs. `service_role` receives only capability check, minimized audit read, support queue read, and support transition execution. Security-definer functions pin `search_path`, validate finite keys/values, verify current Auth identities through membership, and fail closed.

Routes/pages added or changed are recorded in `docs/security/api-authorization-inventory-phase10.md`. Source-contract coverage is in `backend/security/tests/phase10AdminSupportSecurity.test.ts`; PostgreSQL execution requires a local Supabase/PostgreSQL runtime and must not be represented as passed unless actually run.

## Phase boundary and status

Production migration was **not applied** by this Codex task and no Production data was mutated. Phase 9 behavior was not changed. Phase 11 was not started. Phase 12 billing/Stripe was not changed. Phase 13 publishing/provider behavior was not changed. No live provider execution occurred. Historical migrations were not edited.

Phase 10 is **partially engineering-complete** because controlled private-media delivery and automated MFA recovery remain blocked by the explicit contracts above. All independent supported foundations and surfaces described here are implemented; deployment and Production verification remain separately authorized operations.
