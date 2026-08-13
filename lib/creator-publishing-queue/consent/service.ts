import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { activeCreatorIdOrNull } from "../creatorEntitlement"
import { saveAiTwinConsentWithDeps } from "./serviceCore"
import type { AiTwinConsentActionInput } from "./types"
async function getAuthenticatedUserId() { return activeCreatorIdOrNull() }
export async function saveAiTwinConsent(input: AiTwinConsentActionInput) { return saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId, getAdminClient: () => getSupabaseAdmin() as any }) }
