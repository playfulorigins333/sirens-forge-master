import "server-only"
import { getSupabaseAdmin } from "../../../supabaseAdmin"
import { activeCreatorIdOrNull } from "../../creatorEntitlement"
import { submitTrustedComplianceWithDeps } from "./serviceCore"
import type { ComplianceSubmissionInput } from "./types"
export async function submitTrustedCreatorPublishingCompliance(input: ComplianceSubmissionInput) { return submitTrustedComplianceWithDeps(input, { getAuthenticatedUserId:activeCreatorIdOrNull, getAdminClient:()=>getSupabaseAdmin() as any }) }
