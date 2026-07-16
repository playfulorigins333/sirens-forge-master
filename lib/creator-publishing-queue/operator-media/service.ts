import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { createOnlyFansOperatorSignedMediaUrlCore, loadOnlyFansOperatorMediaCore } from "./serviceCore"

async function actorId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) return null; return data.user.id }
export async function loadOnlyFansOperatorMedia(platformJobId: unknown) { return loadOnlyFansOperatorMediaCore(platformJobId, { admin:getSupabaseAdmin() as any, actorId:await actorId(), now:()=>new Date().toISOString() }) }
export async function createOnlyFansOperatorSignedMediaUrl(input: unknown) { return createOnlyFansOperatorSignedMediaUrlCore(input, { admin:getSupabaseAdmin() as any, actorId:await actorId(), now:()=>new Date().toISOString() }) }
