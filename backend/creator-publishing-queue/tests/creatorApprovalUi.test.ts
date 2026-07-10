import assert from "node:assert/strict"
import { mapCreatorApprovalError, approvalStatusLabel, complianceStatusLabel, platformLabel, queueStatusLabel } from "../../../lib/creator-publishing-queue/ui/status"
import { CreatorPublishingApprovalError } from "../../../lib/creator-publishing-queue/approval/types"
import { buildCreatorPublishingApprovalSnapshot } from "../../../lib/creator-publishing-queue/approval/snapshot"

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
