"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { performCreatorPublishingCreatorApproval } from "@/lib/creator-publishing-queue/approval/service"
import { CreatorPublishingApprovalError } from "@/lib/creator-publishing-queue/approval/types"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { supabaseServer } from "@/lib/supabaseServer"
import { mapCreatorApprovalError } from "@/lib/creator-publishing-queue/ui/status"

const schema = z.object({
  content_package_id: z.string().uuid(), decision: z.enum(["approve", "reject"]), expected_compliance_status: z.string().min(1), expected_policy_version: z.string().min(1), expected_package_updated_at: z.string().min(1), approval_snapshot_hash: z.string().length(64), media_manifest_hash: z.string().length(64), idempotency_key: z.string().min(8), rejection_reason: z.string().optional(), creator_notes: z.string().optional(),
})
export type ApprovalActionState = { ok: boolean; message?: string; title?: string; code?: string; reloadRequired?: boolean; controlsDisabled?: boolean }

async function sessionUserId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) redirect("/login"); return data.user.id }

export async function decideCreatorPublishingPackage(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const creatorId = await sessionUserId()
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, title: "Decision not saved", message: "Check the approval form and try again.", code: "INVALID_FORM" }
  if (parsed.data.decision === "reject" && !parsed.data.rejection_reason?.trim()) return { ok: false, ...mapCreatorApprovalError(new CreatorPublishingApprovalError("APPROVAL_REJECTION_REASON_REQUIRED", "Reason required")) }
  try {
    const result = await performCreatorPublishingCreatorApproval({ ...parsed.data, creator_id: creatorId, expected_compliance_status: parsed.data.expected_compliance_status as any, rejection_reason: parsed.data.rejection_reason?.trim() || null, creator_notes: parsed.data.creator_notes?.trim() || null }, { supabaseAdmin: getSupabaseAdmin() as any, authorization: { user_id: creatorId, service_role: false, role: "creator" } })
    revalidatePath("/creator/publishing-queue"); revalidatePath(`/creator/publishing-queue/${parsed.data.content_package_id}`)
    const isFansly = result.target_platform === "fansly"
    return { ok: true, title: result.decision === "reject" ? "Rejected" : "Approved", message: result.decision === "reject" ? "No queue task was created and no publishing action occurred." : isFansly ? "Approval was saved. Publishing queue handoff is disabled for Fansly during MVP; no automatic publishing occurred." : "Approved. The package is ready for manual handoff; Sirens Forge did not automatically publish this content." }
  } catch (error) { const safe = mapCreatorApprovalError(error); return { ok: false, title: safe.title, message: safe.message, code: safe.code, reloadRequired: safe.reloadRequired, controlsDisabled: safe.controlsDisabled } }
}
