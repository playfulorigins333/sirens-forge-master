import "server-only"
import { supabaseServer } from "../../supabaseServer"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import type { OperatorDetailLoaderResult, OperatorListLoaderResult } from "./types"
import { loadOnlyFansOperatorQueueCore, loadOnlyFansOperatorTaskDetailCore } from "./serviceCore"
async function authenticatedActorId(): Promise<string | null> { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) return null; return data.user.id }
export async function loadOnlyFansOperatorQueue(): Promise<OperatorListLoaderResult> { const actorId=await authenticatedActorId(); if (!actorId) return {ok:false,code:"sign_in_required",message:"Sign in to view the operator queue."}; return loadOnlyFansOperatorQueueCore({ admin:getSupabaseAdmin() as any, actorId, now:()=>new Date().toISOString() }) }
export async function loadOnlyFansOperatorTaskDetail(platformJobId: string): Promise<OperatorDetailLoaderResult> { const actorId=await authenticatedActorId(); if (!actorId) return {ok:false,code:"sign_in_required",message:"Sign in to view the operator task."}; return loadOnlyFansOperatorTaskDetailCore(platformJobId, { admin:getSupabaseAdmin() as any, actorId, now:()=>new Date().toISOString() }) }
