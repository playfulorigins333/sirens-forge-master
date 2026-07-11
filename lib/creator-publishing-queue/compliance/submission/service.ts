import "server-only"
import { getSupabaseAdmin } from "../../../supabaseAdmin"
import { supabaseServer } from "../../../supabaseServer"
import { submitTrustedComplianceWithDeps } from "./serviceCore"
import type { ComplianceSubmissionInput } from "./types"
export async function submitTrustedCreatorPublishingCompliance(input: ComplianceSubmissionInput) { return submitTrustedComplianceWithDeps(input, { getAuthenticatedUserId: async()=>{ const supabase=await supabaseServer(); const {data,error}=await supabase.auth.getUser(); if(error) throw error; return data.user?.id ?? null }, getAdminClient:()=>getSupabaseAdmin() as any }) }
