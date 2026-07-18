# Task 20: OnlyFans publishing history

Task 20 provides read-only history for Sirens Forge’s assisted/manual OnlyFans publishing workflow. It does not add automatic OnlyFans posting, platform credentials, browser automation, scraping, or an OnlyFans API integration.

## History surfaces

Creators see **Publication attempts** on the existing content-package detail page. Every authorized assisted OnlyFans platform job for the package appears as a separate attempt, newest attempt first. Each attempt keeps its own timezone and its own timeline.

Authorized operators see a detailed timeline on active task detail pages and on the authorized terminal-history detail surface. Operator history can include sanitized operational identifiers and immutable audit references that are not shown to creators.

## Provenance

Normalized entries distinguish four sources:

- `append_only_audit_evidence`: a durable row in `creator_publishing_audit_events`.
- `immutable_evidence_row_data`: timestamps and verified metadata from the completion-evidence intent lifecycle.
- `reconstructed_completion_state`: a read-only fallback assembled from trusted Task 18 completion state when a Task 20 proof event does not exist.
- `derived_lifecycle_event`: a safe display entry derived from an immutable plan, job, or scheduler row.

Reconstructed history is never presented internally as a newly written audit event and does not backdate or fabricate audit rows.

## Exact-task and limited-job history

Terminal jobs use job-specific durable relationships to resolve their queue task: Task 20 proof audit, Task 18 manual-completion idempotency, then completion evidence. Active jobs may use the existing unique active-task relationship.

When an exact relationship cannot be proven, the attempt is labeled **Limited job history**. Job-level records remain visible, but the timeline does not borrow another attempt’s queue task, final URL, evidence, or completion state.

## Scheduling and gates

Plan-level schedule and reschedule audit events contain a `jobs` array. Each attempt reads only the item whose `job_id` matches that platform job. The timeline records scheduled, rescheduled, blocked, or failed results and preserves the schedule revision when available.

Finite scheduler gate codes are translated into plain creator wording. Operators may see the finite safe code. Request fingerprints, claim tokens, unrestricted exception text, SQL messages, credentials, and results for other jobs are never exposed.

Schedule cancellation, job cancellation, scheduler supersession, and recorded claim cleanup remain separate timeline events.

## Evidence lifecycle

Each evidence intent can produce separate entries at its real timestamps:

- reserved at `created_at`;
- verified at `verified_at`;
- superseded at `invalidated_at`;
- failed at `failed_at`;
- expired at `expired_at`;
- consumed at `consumed_at`.

Replacement relationships remain visible in sanitized operator details. Evidence-intent IDs and digest prefixes are operator-only.

## Completion truth

One logical publication confirmation prefers the Task 20 proof event, then trusted reconstructed completion, then the Task 18 platform-job transition, then the Task 18 queue-task transition. Distinct plan and scheduler bookkeeping remains visible when it conveys a separate event.

A Task 20 proof event preserves the final URL or safe no-URL explanation, evidence relationship, verified MIME type, size, digest prefix for operators, and append-only provenance.

## Filtering and sorting

Every attempt timeline provides native labeled controls for:

- All events;
- Scheduling;
- Operator activity;
- Evidence;
- Completion and rejection.

Sorting supports **Oldest first** and **Newest first**. Oldest first is the default. Filtering and sorting affect only the displayed view and never mutate or reinterpret stored history. Equal timestamps retain a deterministic stable-reference tie-breaker.

## Immutable references

Append-only audit-derived entries include their stable `auditEventId` in the sanitized view model. Operators see it as **Audit event #…**. Creators do not receive idempotency keys, request fingerprints, claim tokens, storage paths, or credentials to create that reference.

## Evidence preview boundary

Task 20 displays verified evidence metadata and lifecycle state. A private evidence image is not exposed unless an already-approved server-authorized short-lived signing pattern is available. The evidence bucket remains private; Task 20 does not create public or permanent object URLs.
