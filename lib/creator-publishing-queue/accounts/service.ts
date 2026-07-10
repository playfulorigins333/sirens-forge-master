import "server-only"
import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { mapPlatformAccountRow, saveCreatorPlatformAccountWithDeps } from "./serviceCore"
import type { AccountDeps, PlatformAccountInput } from "./types"

async function defaultUserId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) return null; return data.user.id }
const defaultDeps: AccountDeps = { getAuthenticatedUserId: defaultUserId, getAdminClient: () => getSupabaseAdmin() as any, randomUUID }
export class CreatorPlatformAccountError extends Error { constructor(public code: string, message: string) { super(message) } }
export async function saveCreatorPlatformAccount(input: PlatformAccountInput, deps: AccountDeps = defaultDeps) { return saveCreatorPlatformAccountWithDeps(input, deps) }
export async function loadCreatorPlatformAccounts(deps: Pick<AccountDeps,"getAuthenticatedUserId"|"getAdminClient"> = defaultDeps) { const creatorId = await deps.getAuthenticatedUserId(); if (!creatorId) redirect("/login"); const { data, error } = await deps.getAdminClient().from("creator_platform_accounts").select("id,platform,platform_username,profile_url,is_virtual_entity,verification_status,verification_attested_at,created_at,updated_at").eq("creator_id", creatorId).in("platform", ["onlyfans", "fansly"]).order("platform", { ascending: true }).order("platform_username", { ascending: true }); if (error) throw new Error("Creator platform accounts could not be loaded."); return (data ?? []).map(mapPlatformAccountRow) }
