import "server-only"
import { randomUUID } from "node:crypto"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { saveCreatorPublishingPackageWithDeps } from "./serviceCore"
import type { ComposerDeps, PackageComposerInput } from "./types"
async function defaultUserId(){ const supabase=await supabaseServer(); const {data,error}=await supabase.auth.getUser(); if(error||!data.user?.id) return null; return data.user.id }
const defaultDeps: ComposerDeps={getAuthenticatedUserId:defaultUserId,getAdminClient:()=>getSupabaseAdmin() as any,randomUUID}
export async function saveCreatorPublishingPackage(input: PackageComposerInput, deps: ComposerDeps=defaultDeps){ return saveCreatorPublishingPackageWithDeps(input,deps) }
