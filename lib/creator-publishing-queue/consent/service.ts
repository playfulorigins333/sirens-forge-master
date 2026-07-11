import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { supabaseServer } from "@/lib/supabaseServer"
import { saveAiTwinConsentWithDeps } from "./serviceCore"
import type { AiTwinConsentActionInput } from "./types"
async function getAuthenticatedUserId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) return null; return data.user.id }
export async function saveAiTwinConsent(input: AiTwinConsentActionInput) { return saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId, getAdminClient: () => getSupabaseAdmin() as any }) }
