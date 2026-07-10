import assert from "node:assert/strict"
import { mapCreatorApprovalError, approvalStatusLabel, complianceStatusLabel, platformLabel, queueStatusLabel, creatorApprovalSuccessMessage } from "../../../lib/creator-publishing-queue/ui/status"
import { CreatorPublishingApprovalError } from "../../../lib/creator-publishing-queue/approval/types"
import { buildCreatorPublishingApprovalSnapshot } from "../../../lib/creator-publishing-queue/approval/snapshot"
import { normalizeCreatorPublishingApprovalError, selectCurrentCreatorApprovalComplianceEvidence } from "../../../lib/creator-publishing-queue/approval/service"
import { CREATOR_APPROVAL_QUEUE_TASK_SELECT, creatorApprovalListEligibility } from "../../../lib/creator-publishing-queue/ui/viewModel"
import fs from "node:fs"

function test(name: string, fn: () => void) { try { fn(); console.log(`ok - ${name}`) } catch (error) { console.error(`not ok - ${name}`); throw error } }

test("safe error mapping hides internals and marks stale snapshots reload-required", () => {
  const safe = mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_STALE_PACKAGE", "relation creator_publishing_content_packages failed"))
  assert.equal(safe.reloadRequired, true)
  assert.equal(safe.message.includes("relation"), false)
  assert.equal(safe.message, "This package changed after it was loaded. Reload it before deciding.")
})

test("status labels distinguish manual handoff from posted language", () => {
  assert.equal(queueStatusLabel("ready_for_handoff"), "Ready for manual handoff")
  assert.equal(queueStatusLabel("scheduled_internally"), "Scheduled internally")
  assert.equal(queueStatusLabel("confirmed_posted_manual"), "Manual posting confirmed")
  assert.equal(queueStatusLabel("ready_for_handoff").includes("Posted"), false)
  assert.equal(approvalStatusLabel("pending"), "Awaiting your approval")
  assert.equal(complianceStatusLabel("escalated_approved" as any), "Escalated Approved")
  assert.equal(platformLabel("fanvue"), "Fanvue")
})

test("snapshot rendering data uses normalized caption and deterministic media order", () => {
  const pkg = { id: "pkg", creator_id: "creator", platform_account_id: "acct", target_platform: "onlyfans" as const, title: "Title", caption_body: "Hello", forced_disclosure_text: "#ai", ai_flag: "ai_generated" as const, ai_detail: { model: true }, second_person_present: false, compliance_status: "passed" as const, compliance_policy_version: "onlyfans-manual-handoff-2026-07-10-v1", creator_approval_status: "pending" as const, scheduled_for: null, created_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z" }
  const media = [
    { id: "b", content_package_id: "pkg", storage_key: "b.png", mime_type: "image/png", sha256: "b".repeat(64), source: "upload" },
    { id: "a", content_package_id: "pkg", storage_key: "a.png", mime_type: "image/png", sha256: "a".repeat(64), source: "ai_pipeline" },
  ]
  const { snapshot, hash } = buildCreatorPublishingApprovalSnapshot(pkg, media, { outcome: "pass" })
  assert.equal(snapshot.final_caption.includes("#ai"), true)
  assert.deepEqual(snapshot.media_assets.map((m) => m.id), ["a", "b"])
  assert.match(hash, /^[a-f0-9]{64}$/)
})

test("approval UI safe errors cover blocking review and missing media", () => {
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_BLOCKING_REVIEW_EXISTS", "x")).controlsDisabled, true)
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_MEDIA_MISSING", "storage key x")).message, "Required media is missing.")
})


test("queue-task query selection uses due_at and not scheduled_for", () => {
  assert.equal(CREATOR_APPROVAL_QUEUE_TASK_SELECT.includes("due_at"), true)
  assert.equal(CREATOR_APPROVAL_QUEUE_TASK_SELECT.includes("scheduled_for"), false)
})

test("same-package unrelated-platform task is not displayed by composite matching", () => {
  const tasks = [
    { content_package_id: "pkg", target_platform: "fansly", status: "ready_for_handoff" },
    { content_package_id: "pkg", target_platform: "onlyfans", status: "scheduled_internally" },
  ]
  const byComposite = new Map(tasks.map((task) => [`${task.content_package_id}:${task.target_platform}`, task]))
  assert.equal(byComposite.get("pkg:onlyfans")?.status, "scheduled_internally")
})

test("current evidence is required for list approvability", () => {
  const pkg = { id: "pkg", creator_id: "creator", target_platform: "onlyfans" as const, title: "Title", compliance_status: "passed" as const, compliance_policy_version: "onlyfans-manual-handoff-2026-07-10-v1", creator_approval_status: "pending" as const, scheduled_for: null, updated_at: "2026-07-10T00:00:00.000Z" }
  assert.equal(creatorApprovalListEligibility(pkg, []).approvable, false)
  assert.equal(creatorApprovalListEligibility(pkg, [{ id: "r1", outcome: "pass", review_source: "automated", compliance_policy_version: pkg.compliance_policy_version, created_at: "2026-07-10T00:01:00.000Z" }]).approvable, true)
})

test("later blocking review makes list item read-only", () => {
  const pkg = { id: "pkg", creator_id: "creator", target_platform: "onlyfans" as const, title: "Title", compliance_status: "passed" as const, compliance_policy_version: "onlyfans-manual-handoff-2026-07-10-v1", creator_approval_status: "pending" as const, scheduled_for: null, updated_at: "2026-07-10T00:00:00.000Z" }
  const reviews = [
    { id: "r1", outcome: "pass", review_source: "automated", compliance_policy_version: pkg.compliance_policy_version, created_at: "2026-07-10T00:01:00.000Z" },
    { id: "r2", outcome: "block", review_source: "human", compliance_policy_version: pkg.compliance_policy_version, created_at: "2026-07-10T00:02:00.000Z" },
  ]
  assert.equal(creatorApprovalListEligibility(pkg, reviews).approvable, false)
  assert.equal(selectCurrentCreatorApprovalComplianceEvidence(pkg as any, reviews).laterBlockingReview?.outcome, "block")
})

test("P0001 approval RPC errors normalize to allowlisted domain errors", () => {
  for (const code of ["APPROVAL_STALE_PACKAGE", "APPROVAL_STALE_POLICY_VERSION", "APPROVAL_ALREADY_DECIDED", "APPROVAL_DUPLICATE", "APPROVAL_BLOCKING_REVIEW_EXISTS", "APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED"] as const) {
    assert.equal(normalizeCreatorPublishingApprovalError({ code: "P0001", message: code, details: null, hint: null }).code, code)
  }
})

test("unknown database errors remain generic safe errors", () => {
  const normalized = normalizeCreatorPublishingApprovalError({ code: "XX000", message: "relation secret.table stack trace", details: "constraint x", hint: null })
  const safe = mapCreatorApprovalError(normalized)
  assert.equal(safe.title, "Decision not saved")
  assert.equal(safe.message, "The decision could not be saved. No publishing action was taken. Try again or reload the package.")
  assert.equal(safe.message.includes("secret"), false)
  assert.equal(safe.controlsDisabled, undefined)
})

test("query errors are not silently rendered as empty UI state", () => {
  const source = fs.readFileSync("lib/creator-publishing-queue/ui/loaders.ts", "utf8")
  assert.match(source, /ensureRead<QueueTaskRow\[\]>\(tasksRes, "queue status"\)/)
  assert.match(source, /ensureRead<MediaListRow\[\]>\(mediaRes, "media"\)/)
  assert.doesNotMatch(source, /select\("id,content_package_id,target_platform,status,scheduled_for,updated_at"\)/)
})

test("controlsDisabled removes decision controls and reloads stale states", () => {
  const source = fs.readFileSync("app/creator/publishing-queue/ApprovalDecisionForm.tsx", "utf8")
  assert.match(source, /state\.controlsDisabled/)
  assert.match(source, /controlsBlocked/)
  assert.match(source, /Reload package/)
  assert.match(source, /window\.location\.reload\(\)/)
  assert.doesNotMatch(source, /onClick=\{\(\) => router\.refresh\(\)\}/)
})

test("success copy reflects exact queue and platform results without automatic posting claims", () => {
  const scheduled = creatorApprovalSuccessMessage({ decision: "approve", target_platform: "onlyfans", queue_task_status: "scheduled_internally" })
  const ready = creatorApprovalSuccessMessage({ decision: "approve", target_platform: "onlyfans", queue_task_status: "ready_for_handoff" })
  const fansly = creatorApprovalSuccessMessage({ decision: "approve", target_platform: "fansly", queue_task_status: null })
  assert.equal(scheduled.message.includes("Scheduled internally"), true)
  assert.equal(ready.message.includes("Ready for manual handoff"), true)
  assert.equal(fansly.message.includes("no queue task was created"), true)
  for (const copy of [scheduled, ready, fansly]) {
    assert.equal(/automatic publishing occurred|did not automatically publish|no automatic publishing occurred/.test(copy.message), true)
    assert.equal(/Successfully uploaded|Live/.test(copy.message), false)
  }
})


test("unrelated uniqueness violations remain generic while approval constraints map duplicate", () => {
  const unrelated = normalizeCreatorPublishingApprovalError({ code: "23505", message: "duplicate key value violates unique constraint other_table_uidx", details: "Key exists", hint: null })
  assert.equal(unrelated instanceof CreatorPublishingApprovalError, false)
  assert.equal(mapCreatorApprovalError(unrelated).code, "APPROVAL_UNKNOWN")
  for (const constraint of ["creator_publishing_queue_one_task_per_package_platform_uidx", "creator_publishing_audit_creator_approval_idempotency_uidx"]) {
    const known = normalizeCreatorPublishingApprovalError({ code: "23505", message: `duplicate key value violates unique constraint ${constraint}`, details: null, hint: null })
    assert.equal((known as CreatorPublishingApprovalError).code, "APPROVAL_DUPLICATE")
  }
})

test("known stale, blocking, and already-decided errors keep expected control behavior", () => {
  assert.equal(normalizeCreatorPublishingApprovalError({ code: "P0001", message: "APPROVAL_STALE_PACKAGE", details: null, hint: null }) instanceof CreatorPublishingApprovalError, true)
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_STALE_PACKAGE", "x")).reloadRequired, true)
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_BLOCKING_REVIEW_EXISTS", "x")).controlsDisabled, true)
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_ALREADY_DECIDED", "x")).controlsDisabled, true)
  assert.equal(mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_REJECTION_REASON_REQUIRED", "x")).controlsDisabled, undefined)
})
