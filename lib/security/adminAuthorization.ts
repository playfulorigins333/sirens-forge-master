import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFreshTotp } from "@/lib/security/mfa"

export const ADMIN_CAPABILITIES = [
  "governance.audit.read",
  "governance.legal_hold.manage",
  "support.case.read",
  "support.case.manage",
  "support.private_access.authorize",
  "safety.case.read",
  "safety.case.manage",
] as const
export type AdminCapability = typeof ADMIN_CAPABILITIES[number]

export type AdminAuthorization =
  | { ok: true; userId: string; freshTotpAt: string }
  | { ok: false; status: 401 | 403 | 428 | 503; code: "ADMIN_UNAUTHENTICATED" | "ADMIN_MFA_REQUIRED" | "ADMIN_FORBIDDEN" | "ADMIN_AUTHORIZATION_UNAVAILABLE"; actionPath?: string }

export async function requireAdminCapability(capability: AdminCapability): Promise<AdminAuthorization> {
  const mfa = await requireFreshTotp()
  if (mfa.ok === false) {
    if (mfa.error === "UNAUTHENTICATED") return { ok: false, status: 401, code: "ADMIN_UNAUTHENTICATED" }
    if (mfa.error === "MFA_LOOKUP_FAILED") return { ok: false, status: 503, code: "ADMIN_AUTHORIZATION_UNAVAILABLE" }
    return { ok: false, status: 428, code: "ADMIN_MFA_REQUIRED", actionPath: mfa.actionPath }
  }
  if (!mfa.freshTotpAt) return { ok: false, status: 428, code: "ADMIN_MFA_REQUIRED", actionPath: "/auth/mfa" }
  const { data, error } = await getSupabaseAdmin().rpc("admin_actor_has_capability", {
    p_actor_user_id: mfa.userId,
    p_capability_key: capability,
  })
  if (error) return { ok: false, status: 503, code: "ADMIN_AUTHORIZATION_UNAVAILABLE" }
  if (data !== true) return { ok: false, status: 403, code: "ADMIN_FORBIDDEN" }
  return { ok: true, userId: mfa.userId, freshTotpAt: mfa.freshTotpAt }
}
