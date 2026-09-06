# Phase 8H — Compliance documents and policy closeout

Status: source closeout in progress. This document distinguishes product-backed statements from external legal/operational work that cannot be satisfied by code or policy wording alone.

## Material policy bundle

Current proposed bundle: `material-policy-2026-09-05-r1`.

- Terms of Service: `terms-2026-09-05-r1`
- Privacy Policy: `privacy-2026-09-05-r1`
- Acceptable Use Policy: `acceptable-use-2026-08-22-r1`
- Acceptance statement: `material-policy-acceptance-2026-09-05-r1`
- Source revision: `policy-source-2026-09-05-r1`

The bundle is source-hash bound. Checkout acceptance and authenticated re-consent use the current material bundle and durable acceptance receipts. A creator-product access check must not treat an older material bundle as current.

## Product-backed statements closed in Phase 8H

### Billing and access

- Payment V2 remains the authoritative checkout path.
- Recurring subscription cancellation is distinct from non-recurring/lifetime `og_throne` access.
- Delinquency handling distinguishes first-miss freeze from the retention countdown that begins after the second miss.
- Policy wording must not imply that a lifetime purchase is a cancellable recurring subscription.

### Retention and deletion

The public privacy language now reflects implemented controls instead of the former manual-process disclaimer:

- private generation media Recently Deleted: 30 days;
- Twin materials Recently Deleted: 30 days;
- voluntary account deletion recovery: 60 days;
- recurring subscription cancellation retention after paid access ends: 60 days;
- subscription delinquency retention after the second missed payment: 60 days;
- Draft working data: 90 days;
- security/governance audit evidence: 12 months;
- aggregate/de-identified information: may be retained longer when it no longer identifies a creator.

Deletion remains subject to narrow lawful preservation exceptions and active legal holds. An active hold blocks destructive deletion only within its documented scope.

### Export and account deletion rights

- Authenticated creators may request a data export through implemented account controls.
- Export packages are temporary and expire.
- Before voluntary account deletion, the creator chooses export-before-deletion or skip-export.
- Voluntary deletion enters a 60-day recovery period.
- Reactivation during that period cancels the pending deletion.
- Eligible creator data proceeds to controlled purge after the recovery period if no reactivation occurs.
- Phase 8G records durable deletion/export-choice receipts and forward-looking audit evidence.

### Governance evidence

Public policy wording describes the governance evidence at the correct abstraction level: scoped metadata, policy/form versions, timestamps, correlation identifiers, and cryptographic references. It must not promise or imply that raw secrets, access tokens, prompts, captions, or private binary content are stored in governance audit records.

### Material policy re-consent

The former statement that a general automated material-policy re-consent system did not exist is obsolete. Current creator-product access checks validate the current material bundle version and evidence hash. A new current material bundle therefore requires a fresh acceptance receipt before protected creator features resume.

## Public safety and reporting routes

Public routes currently include Terms, Privacy, Acceptable Use, Community Guidelines, Underage Policy, Blocked Content, Content Removal, NCII/intimate-content reporting, Complaints, DMCA, 2257/2257A statement, Affiliate Terms, and age gating. `admin@sirensforge.vip` is the operational intake address for the manual complaint/removal/DMCA/NCII workflows.

The public NCII route remains a manual intake route and does not claim an automated case-management system.

## External legal / operational items — not closed by code

### DMCA designated agent

The existing DMCA page describes takedown and counter-notice mechanics, but policy text alone does not establish DMCA safe-harbor compliance. A service provider seeking the protections tied to 17 U.S.C. § 512(c)(2) must separately designate an agent with the U.S. Copyright Office, keep the registration current, and make the designated-agent information publicly available through the service.

Authoritative reference:
- U.S. Copyright Office, 37 C.F.R. § 201.38: https://www.copyright.gov/title37/201/37cfr201-38.html

Closeout evidence required before marking this item complete:
- Copyright Office designation confirmed;
- legal service-provider name and alternate names confirmed;
- designated agent name/title or organization confirmed;
- physical mailing address confirmed;
- telephone number confirmed;
- email address confirmed;
- public DMCA page updated to match the registered designation exactly.

Do not invent or publish missing agent details.

### 18 U.S.C. §§ 2257 / 2257A

The current public statement correctly avoids claiming a blanket exemption. Whether recordkeeping and labeling obligations apply depends on the actual workflow and whether covered depictions involve actual human beings. DOJ guidance states that producers of covered depictions involving actual human beings can have identity/age-verification, recordkeeping, labeling, and inspection obligations.

Authoritative reference:
- U.S. Department of Justice, 18 U.S.C. §§ 2257–2257A Certifications: https://www.justice.gov/criminal/criminal-ceos/18-usc-2257-2257a-certifications

Closeout evidence required before marking this item complete for any covered workflow:
- determine whether Sirens Forge is a producer for the specific workflow;
- identify the records custodian and records location if required;
- implement performer identity/age records where required;
- implement required disclosure/labeling where required;
- determine whether any §2257A certification path applies;
- retain legal review for the final operating posture.

Do not use the website statement as a substitute for required records or labeling.

## Other external review

Phase 8H source closeout is a product/compliance consistency pass, not a substitute for counsel. Final launch should include legal review of the material policy bundle, DMCA operating posture, any applicable §2257/2257A posture, state privacy-law applicability, tax/payment disclosures, and any platform-specific contractual obligations that depend on Sirens Forge's final launch jurisdictions and workflows.

## Phase boundary

Phase 8H does not:

- alter Payment V2 prices or Stripe price IDs;
- alter checkout seat inventory;
- replace billing, retention, export, or deletion state machines;
- enable Phase 9 notification delivery;
- create a DMCA agent registration;
- create or fabricate §2257 records;
- claim legal compliance that requires external evidence not present in the repository.
