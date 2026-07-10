"use server"

import { revalidatePath } from "next/cache"
import { saveCreatorPlatformAccount } from "@/lib/creator-publishing-queue/accounts/service"

export type PlatformAccountActionState = { ok: boolean; code?: string; message?: string }
function bool(v: FormDataEntryValue | null) { return v === "on" || v === "true" }
async function save(formData: FormData, accountId?: string | null): Promise<PlatformAccountActionState> { const result = await saveCreatorPlatformAccount({ accountId, platform: String(formData.get("platform") ?? ""), platformUsername: String(formData.get("platformUsername") ?? ""), profileUrl: String(formData.get("profileUrl") ?? ""), isVirtualEntity: bool(formData.get("isVirtualEntity")), creatorAttested: bool(formData.get("creatorAttested")), idempotencyKey: String(formData.get("idempotencyKey") ?? "") }); if (result.ok === false) return { ok: false, code: result.code, message: result.message }; revalidatePath("/creator/publishing-queue/accounts"); revalidatePath("/creator/publishing-queue"); return { ok: true, message: "Platform account reference saved." } }
export async function createCreatorPlatformAccount(_prev: PlatformAccountActionState, formData: FormData) { return save(formData, null) }
export async function updateCreatorPlatformAccount(_prev: PlatformAccountActionState, formData: FormData) { return save(formData, String(formData.get("accountId") ?? "")) }
