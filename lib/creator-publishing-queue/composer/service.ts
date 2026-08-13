import "server-only"
import { randomUUID } from "node:crypto"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { activeCreatorIdOrNull } from "../creatorEntitlement"
import { saveCreatorPublishingPackageWithDeps } from "./serviceCore"
import type { ComposerDeps, PackageComposerInput } from "./types"
async function defaultUserId(){ return activeCreatorIdOrNull() }
const defaultDeps: ComposerDeps={getAuthenticatedUserId:defaultUserId,getAdminClient:()=>getSupabaseAdmin() as any,randomUUID}
export async function saveCreatorPublishingPackage(input: PackageComposerInput, deps: ComposerDeps=defaultDeps){ return saveCreatorPublishingPackageWithDeps(input,deps) }
