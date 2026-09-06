# Phase 11 — legal, privacy, acceptable use, safety, age, NCII, and IP closeout

## Status

**Phase 11 source/application implementation is complete. Production and external gates remain separate.** The corrected migration passed disposable PostgreSQL integration using the real Phase 8 governance and Phase 10 administration migrations. This is an engineering closeout, not legal advice or a claim of legal sufficiency.

## A. Implemented / source complete

- Proxy enforces a server-issued, HttpOnly, 180-day age **self-attestation** cookie before adult/product pages and browser-facing product APIs. It is additive to, and never replaces, API authentication/ownership/entitlement controls. A finite exemption preserves legal/safety intake, age attestation, health, webhooks, internal jobs, provider callbacks, Auth, and browser infrastructure. It is not identity, DOB, government-ID, biometric, or third-party age verification. Validated same-origin `next` paths prevent open redirects; explicit `attest=18plus` and same-origin browser-request checks prevent silent cross-site attestation.
- Terms, Privacy, AUP, community, underage, blocked-content, removal, complaints, NCII, DMCA, 2257, contact, Auth/Next/Vercel internals, and the specifically classified safety, health, webhook, callback, and internal APIs remain reachable without attestation. Browser product APIs require attestation, and every API’s stronger authorization remains handler-owned.
- Forward migration `20260906110000_phase11_legal_safety_cases.sql` creates privacy-minimized cases, finite P0–P3 severity/categories/states, deletion-safe Auth references, deterministic pagination, append-only chronology, forced RLS, revoked grants, create-only public RPC, and capability/audit-checked admin RPCs.
- Founder administrators receive `safety.case.read/manage`. An unassigned `trust_safety_operator` role supports future controlled assignment. Support and security operators receive neither capability.
- Anonymous text-only reporting supports complaints, removals, NCII/unauthorized intimate AI, suspected underage/exploitation, and copyright/DMCA. Exact content types, byte limits, allowlisted bounded fields, safe errors, no-store, no uploads, and acknowledgement-only public references are enforced.
- NCII requires affected-person/authorized-representative declaration and good faith. Underage intake is P0. Warnings prohibit unnecessary evidence copying/upload and no legal conclusion or external-reporting integration is claimed.
- The admin queue/detail/chronology/transitions require verified user + fresh TOTP/AAL2 + database capability. Reads/transitions append minimized governance evidence. Operators see only valid next states. Closure requires a safe outcome; reopen clears the mutable current closure projection while retaining the historical closure outcome in append-only chronology. There is no deletion, ban, signed URL, private-media browser, Auth mutation, or external-report action.
- A provider-neutral future-activation safety decision contract fails closed without authoritative versioned `ALLOW` evidence. It is not integrated into an enqueue boundary because there is no authoritative decision producer, is not a classifier or runtime moderation, and does not activate existing offline generation/provider execution.
- Existing AI Twin/persona consent ownership, grant/revoke, hashes, publishing consent, Fanvue synthetic-persona, and OnlyFans likeness boundaries were not replaced or weakened.
- Authorization inventory, source/PostgreSQL tests, and hosted workflow cover new boundaries.

Terms, Privacy, and AUP canonical sources were audited but not materially changed; current material-policy versions/hashes remain correct and no re-consent rollforward was manufactured. Reporting pages outside that accepted bundle now describe structured intake.

The generic copyright form opens a preliminary review case only. It is not represented as a complete formal DMCA notice; formal notices still use `admin@sirensforge.vip` and must contain every element on the DMCA page. Assignment, escalation-reference, preservation, and retention-review columns remain deliberately internal/deferred: no arbitrary assignment API or substitute legal-hold workflow is exposed, and Phase 8 legal holds remain authoritative.

## B. Production migration required

`supabase/migrations/20260906110000_phase11_legal_safety_cases.sql` requires separate Production authorization. It was **not** applied here. Do not declare Production intake operational before migration and route verification.

## C. Production verification required

After authorized deployment/migration, verify synthetic intake, P0 classification, acknowledgement-only responses, capability denials, fresh-TOTP founder queue/detail/transitions, chronology, minimized audit events, age redirects/cookie attributes, every legal exemption, custom-domain alias, and public responses. Use no real sensitive evidence and perform no enforcement.

## D. External legal / operational blockers

| Missing evidence/action | Why source cannot complete it | Closure evidence |
|---|---|---|
| Copyright Office DMCA designated-agent registration/details | External legal/company action; inventing details or safe-harbor status would be false. | Registration confirmation and counsel-approved public details/aliases. |
| Final §§2257/2257A producer/applicability determination | Depends on operating facts and legal interpretation. | Counsel determination and, if applicable, approved custodian, records location, labels, and procedures. |
| Jurisdiction/state privacy and age-assurance review | Depends on launch jurisdictions, processing facts, and changing law. | Counsel-approved matrix and separately authorized controls. |
| Mandatory external safety reporting process | No NCMEC/CyberTipline integration, staffing authority, or approved disclosure procedure is evidenced. | Counsel-approved duties, authorized reporter, verified account/process, and non-Production exercise. |
| Final counsel review | Engineering cannot declare legal sufficiency. | Dated approval of policies, fields, retention, notices, and procedures. |

## E. Deferred / fail-closed

- Production migration/deployment/aliases, staffing, retention disposition, external reporting, legal disclosure, and destructive enforcement require separate authorization.
- Human admin private-media access and automated MFA recovery remain unavailable.
- Evidence uploads are unavailable; restricted evidence storage requires a separate design.
- No authoritative runtime classifier is evidenced. Pods remain offline; activation must satisfy the fail-closed decision contract and final provider/legal gate.
- No automatic email, SLA, ban, deletion, payment, OAuth/provider, or Production action was added.
