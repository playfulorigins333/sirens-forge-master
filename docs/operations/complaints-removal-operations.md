# Complaints and content-removal operations

**Launch runbook — source-only operating contract**
**Accountable intake:** `admin@sirensforge.vip`
**Last reviewed:** 2026-08-22

## 1. Purpose and scope

This runbook gives an authorized Sirens Forge operator a finite, auditable procedure for general complaints; account or enforcement appeals; unauthorized likeness or identity complaints; privacy or safety reports; content-removal requests; copyright/DMCA matters; suspected underage content; non-consensual or exploitative content; and legal, regulatory, or law-enforcement requests.

This is an operational procedure, not legal advice and not evidence of legal sufficiency. The operator must escalate questions requiring legal judgment. Nothing here supplies a jurisdiction-specific conclusion, deadline, or authority to mutate Production. Each real restriction, removal, disclosure, preservation action, or account enforcement requires the separately authorized access and approval described below.

## 2. Accountable intake owner

The public intake is `admin@sirensforge.vip`. The public `/report-intimate-content` route directs NCII and unauthorized intimate AI/deepfake reports to that same manual mailbox; it does not submit to a case-management API or trigger a Production action. General complaints and removal routes remain separate entry points into this same runbook. The accountable operational owner is the authorized Sirens Forge operator responsible for that mailbox. That operator acknowledges intake, assigns a case ID and severity, maintains the case record, coordinates review, and confirms closure.

No named employee or backup operator is established by repository evidence. If no approved backup operator is documented and the owner is unavailable, do not silently reassign access or share mailbox credentials. Record the coverage gap, keep the case in `RECEIVED`, and escalate through the approved company leadership/contact channel to appoint an authorized operator. P0 reports require immediate coverage escalation. Never place mailbox credentials in a case record.

## 3. Case identifier and record location

Assign `SF-CR-YYYYMMDD-###`, where the date is the UTC intake date and the sequence is a zero-padded daily number. Check the restricted case index before assignment to avoid duplicates. The identifier can be maintained in an approved access-restricted document or ticket system; it does not require or authorize a Production database.

Repository review found public policy/contact pages and product consent controls, but no dedicated complaint/removal case-management schema, service, admin UI, or case workflow. Until an approved system exists, the restricted non-Production record described here is the launch record. Do not put requester evidence or personal data in source control.

## 4. Required intake fields

Create a case with all fields below; use `unknown`, `not provided`, or `not applicable` rather than silently omitting a field.

- Case ID and received timestamp (UTC)
- Requester/contact and preferred safe contact method
- Whether an NCII reporter is the depicted/affected person or is authorized to act for them
- Complaint category
- Affected account, content, or other reference
- URLs and asset IDs, where available
- Requester's description
- For an intimate-content report, why the depiction is believed nonconsensual or unauthorized and the reporter's good-faith accuracy statement
- Evidence supplied, stored as restricted references rather than unnecessary copies
- Requested outcome
- Severity (`P0`, `P1`, `P2`, or `P3`)
- Assigned owner
- Current workflow state
- Action taken and reason code, or `none`
- Notification state and notification references
- Closure date, when closed
- Retention, preservation, and escalation notes

Never record passwords, tokens, secret keys, authentication cookies, private encryption material, or unnecessary sensitive information. Ask a requester who supplied a secret to revoke it through the appropriate secure channel; redact it from working records without repeating it.

## 5. Finite workflow states and transitions

The allowed states are:

- `RECEIVED` — intake captured and case ID assigned.
- `TRIAGED` — category, affected reference, severity, owner, and next step recorded.
- `INFORMATION_NEEDED` — a specific minimum-necessary information request is outstanding.
- `UNDER_REVIEW` — evidence and applicable platform policies are being evaluated.
- `ESCALATED` — an approved legal, safety, leadership, regulatory, or law-enforcement path owns or advises the next decision.
- `ACTION_PENDING` — a decision is recorded but separately authorized execution or verification remains pending.
- `ACTIONED` — authorized action and before/after evidence are recorded.
- `NOTIFIED` — required appropriate-party notices are recorded.
- `APPEAL_OR_COUNTERNOTICE` — an appeal or DMCA counter-notification is under review.
- `CLOSED` — closure criteria, outcome, notifications, and retention/escalation notes are complete.

Normal transitions are `RECEIVED → TRIAGED → UNDER_REVIEW → ACTION_PENDING → ACTIONED → NOTIFIED → CLOSED` or `RECEIVED → TRIAGED → INFORMATION_NEEDED → UNDER_REVIEW`. Review may move to `ESCALATED`, and an action or notice may move to `APPEAL_OR_COUNTERNOTICE`, then back to review/escalation. A no-action decision may move `UNDER_REVIEW → NOTIFIED → CLOSED`. Reopening creates a new chronology entry and returns to `UNDER_REVIEW`; never erase the earlier state. Every transition requires UTC timestamp, operator, reason, and evidence/notice references.

## 6. Triage and priority matrix — INTERNAL OPERATIONAL TARGETS

These are conservative proposed launch targets **requiring operator approval**. They are internal operating goals, not public promises, service-level guarantees, or statutory deadlines. Applicable legal requirements, once determined by qualified review, take precedence.

| Priority | Examples | Proposed acknowledgement target | Proposed triage/escalation target |
|---|---|---:|---:|
| **P0** | Immediate safety; suspected underage content; credible non-consensual or exploitative material | As soon as practicable, target 1 hour while staffed | Immediately, target 1 hour; minimize access/duplication and escalate to the authorized safety/legal path |
| **P1** | Unauthorized likeness; serious privacy/safety issue; urgent rights complaint | Target 1 business day | Target 1 business day; consider documented temporary restriction through separate authorization |
| **P2** | Copyright/DMCA; account/content enforcement dispute; ordinary removal request | Target 2 business days | Target 3 business days; route DMCA matters to DMCA-specific review |
| **P3** | Routine complaint; product/process complaint | Target 3 business days | Target 5 business days or request minimum necessary information |

Triage severity by credible potential harm, urgency, vulnerability, dissemination, and preservation needs—not by requester visibility. Record missed targets and why; do not close a case merely to meet a target. The public pages intentionally promise no hard operational response deadline.

## 7. Evidence handling

1. Collect only evidence necessary to locate the affected resource, understand the allegation, and support the decision. Preserve original received timestamps, headers or references where available.
2. Prefer stable URLs, account/content/asset IDs, text descriptions, and a minimum screenshot over downloading or duplicating media. Record the source and collection timestamp; do not alter originals.
3. Store evidence in approved restricted storage and put only an access-controlled reference in the case log. Redact unrelated personal data and secrets from working copies and notices. Never store credentials, cookies, tokens, encryption material, or secret keys.
4. Separate privileged, legal, regulatory, and law-enforcement materials where the approved access model requires it. Do not disclose or forward them beyond authorized reviewers.
5. For suspected underage or illegal exploitative material, do not casually open, download, screenshot, forward, or redistribute it. Minimize viewing and duplication, record the reporter's supplied reference, and immediately escalate to the authorized safety/legal path for handling instructions. Do not make a legal conclusion in the case log.
6. Preservation means preserving minimum necessary references and evidence through approved restricted systems. It does not authorize altering the protected Production admin, mutating Production, applying SQL, or changing retention flags.
7. Never use destructive testing, upload/post material, invoke a provider, or reproduce the reported behavior. Tabletop work uses synthetic text-only fixtures.

## 8. Decision and escalation matrix

| Decision | Decision authority / required handling |
|---|---|
| No action | Authorized intake operator may decide when documented policy/evidence supports it; record reason and notify the requester as appropriate. |
| Information request | Assigned operator may request only the missing minimum necessary details. |
| Temporary restriction | Authorized enforcement operator plus the separately approved Production action; escalate safety/legal uncertainty. |
| Content removal/restriction | Authorized enforcement operator plus separately approved Production action; record scope, reason, and before/after evidence. |
| Account enforcement | Authorized enforcement operator under platform policy plus separately approved Production action; escalate permanent or legally sensitive outcomes. |
| Legal review | Operator escalates when rights, jurisdiction, disclosure, preservation, legal process, or statutory interpretation is material. |
| Law-enforcement/regulatory request | Segregate materials and escalate to the authorized legal/company decision-maker; verify authority through an approved channel before any disclosure or action. |
| DMCA handling | Route to the existing public DMCA policy and authorized DMCA/legal reviewer; do not improvise requirements or timing. |
| Appeal/counter-notification | A reviewer authorized to reconsider the original decision reviews the complete chronology; use DMCA-specific review for counter-notifications. |

Where the repository does not identify an authorized legal reviewer or enforcement role-holder, the intake operator must mark `ESCALATED` and obtain an approved company decision-maker rather than inventing authority. This runbook grants no Production access and this task performs no enforcement.

## 9. Authorized action procedure

For a real case, an appropriately authorized operator would:

1. Confirm case ID, authority, current state, and whether legal/safety escalation is required.
2. Verify the exact affected resource by stable ID/URL and ownership context without exploring unrelated data.
3. Preserve only necessary evidence and record the pre-action state, timestamp, evidence reference, and proposed reason code.
4. Select the least destructive action adequate to the documented decision (for example, scoped restriction before broader account action where appropriate).
5. Obtain separate approval for the Production action and legal/safety review where required. Move to `ACTION_PENDING`; never treat documentation as execution authority.
6. On authorized execution, use the approved administrative procedure; do not share credentials or bypass access controls. Record operator, UTC time, exact scope, reason code, and result.
7. Verify and record the post-action state without destructive testing or provider interaction.
8. Send only appropriate notices, avoiding sensitive evidence or another party's private information; save notification references.
9. Preserve the immutable chronology. Move through `ACTIONED` and `NOTIFIED`, then close only when closure criteria are met; otherwise escalate.

Suggested reason-code families are `SAFETY`, `UNDERAGE_REPORT`, `NONCONSENSUAL`, `LIKENESS`, `PRIVACY`, `COPYRIGHT_DMCA`, `PLATFORM_POLICY`, `ACCOUNT_APPEAL`, `LEGAL_PROCESS`, and `INSUFFICIENT_INFORMATION`. Add a factual note; a reason code is not a legal conclusion.

## 10. Internal notice templates

Replace bracketed fields, disclose only minimum necessary information, and store the sent-message reference. These templates promise neither outcome nor timing.

### Complaint received

**Subject:** `[CASE_ID] Complaint received`
We received your complaint and assigned reference `[CASE_ID]`. We will review the information under applicable Sirens Forge policies and may request more information. This acknowledgement does not indicate an outcome. Please do not send passwords, tokens, or unnecessary sensitive material.

### Additional information requested

**Subject:** `[CASE_ID] Additional information requested`
To continue reviewing `[CASE_ID]`, please provide `[SPECIFIC_MINIMUM_INFORMATION]`. Do not send credentials or unrelated sensitive information. If available, use stable URLs or asset IDs rather than duplicating sensitive content.

### Action taken

**Subject:** `[CASE_ID] Review action`
We completed a review and took the following platform action: `[SAFE_ACTION_SUMMARY]`. This notice describes a platform decision and does not determine legal ownership or rights. `[APPEAL_OR_CONTACT_INSTRUCTIONS]`

### No action taken

**Subject:** `[CASE_ID] Review outcome`
Based on the information available and applicable platform policy, we are not taking platform action at this time. This does not determine legal rights. You may reply with material new information and reference `[CASE_ID]`.

### Removal completed

**Subject:** `[CASE_ID] Removal completed`
The scoped content identified in our decision has been removed or restricted from the applicable Sirens Forge surface. This confirms the recorded platform action only and does not make a broader legal determination.

### Account/content enforcement notice

**Subject:** `[CASE_ID] Sirens Forge enforcement notice`
Sirens Forge applied `[RESTRICTION]` to `[SCOPED_REFERENCE]` under `[POLICY/REASON]`. Do not include prohibited or private evidence in a reply. If an appeal is available, submit the basis and any material new information to `admin@sirensforge.vip` with `[CASE_ID]`.

### Appeal received

**Subject:** `[CASE_ID] Appeal received`
We received your appeal concerning `[DECISION_REFERENCE]`. It will be reviewed against the case record and any material new information. Receipt does not guarantee reversal. For a DMCA counter-notification, consult the existing DMCA policy; this message adds no legal requirements or timing.

### Case closed

**Subject:** `[CASE_ID] Case closed`
Our current review of `[CASE_ID]` is closed with outcome `[SAFE_OUTCOME_SUMMARY]`. Records will be handled under approved retention and privacy controls. A materially new report may be submitted by referencing this case.

## 11. Audit record template

Keep chronology append-only/immutable: correct an error with a new entry, never overwrite the original. The template works in an approved restricted non-Production document or ticket.

```text
CASE: SF-CR-YYYYMMDD-###
RECEIVED_UTC: [ISO-8601]
CATEGORY / SEVERITY: [category] / [P0-P3]
OWNER / CURRENT_STATE: [authorized role or operator] / [allowed state]
AFFECTED_REFERENCE: [minimum stable reference]
RETENTION / ESCALATION: [restricted-access handling; escalation reference]

CHRONOLOGY (append only)
[UTC timestamp] | [operator] | [old state -> new state] | [action]
Reason: [policy/factual reason]
Evidence reference: [restricted reference or none; never secrets]
Notification reference: [message/ticket reference or none]
```

Record notifications as references plus recipient category and sent timestamp, not as unnecessary copies of private data.

## 12. Retention and privacy

Restrict case and evidence access to authorized operators and reviewers with a case need. Collect and retain the minimum necessary; segregate especially sensitive or legal material; use approved secure storage; and document access, preservation holds, disclosure, and disposition. Do not place case data in repository files, public channels, or general analytics.

Absent an approved, repository-supported duration, **retain only as long as operationally or legally necessary under approved company policy.** Do not invent a statutory period. A preservation or deletion decision that depends on law requires escalation, and any Production mutation requires separate authorization.

## 13. Safe synthetic tabletop exercises

All tabletop inputs below are fictional, text-only, and contain no customer, user, provider, or real-person data. Exercises require no Production mutation, upload, post, provider call, or real removal/enforcement action. Record simulated decisions as `TABLETOP ONLY` outside the live case sequence.

### A. Unauthorized likeness request

- **Synthetic intake:** A fictional requester says generated asset `synthetic-asset-A` resembles them without permission and supplies a synthetic URL and description.
- **Expected severity:** P1.
- **Expected workflow:** `RECEIVED → TRIAGED → UNDER_REVIEW → ACTION_PENDING → ACTIONED → NOTIFIED → CLOSED` (all action steps simulated).
- **Escalation point:** Identity dispute, unclear authorization, high dissemination, or legal claim; escalate for legal review.
- **Decision record:** `TABLETOP ONLY`; least-destructive simulated restriction; reason `LIKENESS`; minimum evidence references.
- **Notification record:** Complaint-received and simulated action/removal outcome references.
- **Closure criteria:** Scoped resource and authorization reviewed, simulated decision/notice recorded, retention notes complete.

### B. Suspected underage / exploitative-content report

- **Synthetic intake:** A text-only report alleges `synthetic-asset-B` may depict an underage or exploited person; no image is attached.
- **Expected severity:** P0.
- **Expected workflow:** `RECEIVED → TRIAGED → ESCALATED → ACTION_PENDING → ACTIONED → NOTIFIED → CLOSED`, with no media opened or copied.
- **Escalation point:** Immediate authorized safety/legal escalation before substantive evidence handling or action.
- **Decision record:** `TABLETOP ONLY`; access/duplication minimized; reason `UNDERAGE_REPORT`; no legal conclusion.
- **Notification record:** Receipt reference and safe, non-evidentiary simulated outcome reference.
- **Closure criteria:** Escalation accepted, simulated least-destructive action documented, no prohibited material duplicated, preservation/retention instruction recorded.

### C. Copyright/DMCA notice

- **Synthetic intake:** A fictional rights holder identifies `synthetic-asset-C` and provides a text-only notice with fictional contact details.
- **Expected severity:** P2 unless separate safety facts raise it.
- **Expected workflow:** `RECEIVED → TRIAGED → UNDER_REVIEW → INFORMATION_NEEDED` if incomplete, otherwise `ESCALATED → ACTION_PENDING → ACTIONED → NOTIFIED → CLOSED`; counter-notice moves to `APPEAL_OR_COUNTERNOTICE`.
- **Escalation point:** DMCA-specific authorized/legal review using the existing DMCA policy.
- **Decision record:** `TABLETOP ONLY`; completeness questions and simulated scoped action; reason `COPYRIGHT_DMCA`.
- **Notification record:** Receipt, information request if needed, and simulated party notices without invented timing.
- **Closure criteria:** Authorized reviewer disposition, appropriate simulated notices, counter-notification state resolved or referenced, retention notes complete.

### D. Account/content enforcement appeal

- **Synthetic intake:** A fictional account holder appeals simulated restriction `synthetic-decision-D` and provides new text-only context.
- **Expected severity:** P2 unless credible safety facts increase priority.
- **Expected workflow:** `RECEIVED → TRIAGED → APPEAL_OR_COUNTERNOTICE → UNDER_REVIEW → NOTIFIED → CLOSED`.
- **Escalation point:** Reviewer lacks authority, original decision involved P0/P1 safety, or new legal issue arises.
- **Decision record:** `TABLETOP ONLY`; uphold, modify, or reverse simulation with policy reason and original-decision reference.
- **Notification record:** Appeal receipt and simulated enforcement outcome references.
- **Closure criteria:** Complete chronology independently reviewed, decision and notice recorded, any follow-up action represented but not performed.

### E. Ordinary complaint with insufficient evidence

- **Synthetic intake:** A fictional user says “something is wrong” without account, URL, asset ID, or reproducible description.
- **Expected severity:** P3.
- **Expected workflow:** `RECEIVED → TRIAGED → INFORMATION_NEEDED → UNDER_REVIEW → NOTIFIED → CLOSED` or close after a documented reasonable information request yields no usable detail.
- **Escalation point:** New facts indicate safety, likeness, privacy, copyright, or legal-process concerns.
- **Decision record:** `TABLETOP ONLY`; reason `INSUFFICIENT_INFORMATION`; list only the missing minimum fields.
- **Notification record:** Receipt, focused information request, and no-action/case-closed references.
- **Closure criteria:** Request made without seeking secrets, response evaluated or absence recorded, no-action basis and reopen path documented.

## Launch gate and authority boundary

The runbook, public-policy alignment, and regression contract close the source/documentation/testing portion of roadmap row 46. Human legal sufficiency remains separate and unknown until qualified human review. This source gate neither proves staffed execution nor authorizes a Production or external action.
