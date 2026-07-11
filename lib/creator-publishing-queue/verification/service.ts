import "server-only"
import { supabaseServer } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { applyTrustedVerificationDecisionWithDeps } from "./serviceCore"
import type { VerificationInput } from "./types"
export async function applyTrustedVerificationDecision(input: VerificationInput) { return applyTrustedVerificationDecisionWithDeps(input, { getAdminClient: getSupabaseAdmin as any, getAuthenticatedUserId: async () => { const supabase = await supabaseServer(); const { data } = await supabase.auth.getUser(); return data.user?.id ?? null } }) }
