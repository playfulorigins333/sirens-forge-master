import "server-only"
import { supabaseServer } from "../../supabaseServer"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import type { OperatorClaimInput, OperatorProgressInput, OperatorRecoverExpiredClaimInput, OperatorReleaseInput } from "./types"
import { claimOnlyFansOperatorTaskCore, recoverExpiredOnlyFansOperatorClaimCore, releaseOnlyFansOperatorTaskCore, updateOnlyFansOperatorProgressCore } from "./serviceCore"
async function authenticatedActorId(): Promise<string | null> { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) return null; return data.user.id }
const signIn = { ok:false as const, code:"sign_in_required" as const, message:"Sign in to use the operator queue.", retryable:false }
export async function claimOnlyFansOperatorTask(input: OperatorClaimInput) { const actorId = await authenticatedActorId(); if (!actorId) return signIn; const admin = getSupabaseAdmin(); return claimOnlyFansOperatorTaskCore(input, { actorId }, { admin: admin as any }) }
export async function releaseOnlyFansOperatorTask(input: OperatorReleaseInput) { const actorId = await authenticatedActorId(); if (!actorId) return signIn; const admin = getSupabaseAdmin(); return releaseOnlyFansOperatorTaskCore(input, { actorId }, { admin: admin as any }) }
export async function updateOnlyFansOperatorProgress(input: OperatorProgressInput) { const actorId = await authenticatedActorId(); if (!actorId) return signIn; const admin = getSupabaseAdmin(); return updateOnlyFansOperatorProgressCore(input, { actorId }, { admin: admin as any }) }
export async function recoverExpiredOnlyFansOperatorClaim(input: OperatorRecoverExpiredClaimInput) { const actorId = await authenticatedActorId(); if (!actorId) return signIn; const admin = getSupabaseAdmin(); return recoverExpiredOnlyFansOperatorClaimCore(input, { actorId }, { admin: admin as any }) }
