import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { supabaseServer } from "@/lib/supabaseServer"
import { MATERIAL_POLICY_MANIFEST as manifest, materialPolicyBundleEvidence } from "./manifest"

export type ReceiptSource = "payment_first_checkout" | "authenticated_reconsent"
export const POLICY_ACCEPTANCE_REQUIRED = "POLICY_ACCEPTANCE_REQUIRED"

const authoritativeReceipt = {
  p_material_bundle_version: manifest.materialBundleVersion,
  p_terms_version: manifest.termsVersion,
  p_privacy_version: manifest.privacyVersion,
  p_acceptable_use_version: manifest.acceptableUseVersion,
  p_acceptance_statement_version: manifest.acceptanceStatementVersion,
  p_source_revision: manifest.sourceRevision,
  p_bundle_source_sha256: materialPolicyBundleEvidence(),
}

export function validateAcceptanceDeclaration(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false as const, code: "MATERIAL_POLICY_ACCEPTANCE_REQUIRED" }
  const declaration = value as Record<string, unknown>
  if (declaration.accepted !== true) return { ok: false as const, code: "MATERIAL_POLICY_ACCEPTANCE_REQUIRED" }
  if (declaration.materialBundleVersion !== manifest.materialBundleVersion) return { ok: false as const, code: "MATERIAL_POLICY_VERSION_MISMATCH" }
  return { ok: true as const }
}

export async function recordCheckoutAcceptance(db: any, holdId: string, purchaserHash: Uint8Array) {
  const { data, error } = await db.rpc("record_payment_first_material_policy_acceptance", {
    p_hold_id: holdId,
    p_purchaser_hash: `\\x${Buffer.from(purchaserHash).toString("hex")}`,
    ...authoritativeReceipt,
  })
  if (error || typeof data !== "string") throw new Error("MATERIAL_POLICY_RECEIPT_WRITE_FAILED")
  return data
}

export async function recordAuthenticatedAcceptance(input: unknown) {
  const declaration = validateAcceptanceDeclaration(input)
  if (!declaration.ok) return { ok: false as const, status: 409, code: declaration.code }
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, code: "UNAUTHENTICATED" }
  const { data, error } = await getSupabaseAdmin().rpc("record_authenticated_material_policy_acceptance", { p_auth_user_id: user.id, ...authoritativeReceipt })
  if (error || typeof data !== "string") return { ok: false as const, status: 503, code: "MATERIAL_POLICY_RECEIPT_WRITE_FAILED" }
  return { ok: true as const, receiptId: data }
}

export async function hasCurrentMaterialPolicyAcceptance(authUserId: string, profileId: string) {
  const db = getSupabaseAdmin()
  const evidence = materialPolicyBundleEvidence()
  const direct = await db.from("material_policy_acceptance_receipts").select("id").eq("auth_user_id", authUserId)
    .eq("material_bundle_version", manifest.materialBundleVersion).eq("bundle_source_sha256", evidence).limit(1)
  if (direct.error) throw new Error("MATERIAL_POLICY_ACCEPTANCE_LOOKUP_FAILED")
  if ((direct.data ?? []).length === 1) return true
  const claimed = await db.from("material_policy_acceptance_receipts").select("id,payment_v2_holds!inner(payment_v2_purchases!inner(claimed_profile_id,state))")
    .eq("source", "payment_first_checkout").eq("material_bundle_version", manifest.materialBundleVersion)
    .eq("bundle_source_sha256", evidence).eq("payment_v2_holds.payment_v2_purchases.claimed_profile_id", profileId)
    .eq("payment_v2_holds.payment_v2_purchases.state", "CLAIMED").limit(1)
  if (claimed.error) throw new Error("MATERIAL_POLICY_ACCEPTANCE_LOOKUP_FAILED")
  return (claimed.data ?? []).length === 1
}

export async function currentAcceptanceForAuthenticatedUser() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { authenticated: false as const, accepted: false }
  const profile = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle()
  if (profile.error || !profile.data) throw new Error("PROFILE_LOOKUP_FAILED")
  return { authenticated: true as const, accepted: await hasCurrentMaterialPolicyAcceptance(user.id, profile.data.id) }
}
