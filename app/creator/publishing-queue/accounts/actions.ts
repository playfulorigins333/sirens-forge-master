"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { saveCreatorPlatformAccount } from "@/lib/creator-publishing-queue/accounts/service"

export type PlatformAccountActionState = { ok: boolean; code?: string; message?: string }
const updateAccountIdSchema = z.string().uuid()
function bool(v: FormDataEntryValue | null) { return v === "on" || v === "true" }
function fields(formData: FormData) { return { platform: String(formData.get("platform") ?? ""), platformUsername: String(formData.get("platformUsername") ?? ""), profileUrl: String(formData.get("profileUrl") ?? ""), isVirtualEntity: bool(formData.get("isVirtualEntity")), creatorAttested: bool(formData.get("creatorAttested")), idempotencyKey: String(formData.get("idempotencyKey") ?? "") } }
function invalidForm(): PlatformAccountActionState { return { ok: false, code: "INVALID_FORM", message: "Check the account form and try again." } }
async function persist(input: Parameters<typeof saveCreatorPlatformAccount>[0]): Promise<PlatformAccountActionState> { const result = await saveCreatorPlatformAccount(input); if (result.ok === false) return { ok: false, code: result.code, message: result.message }; revalidatePath("/creator/publishing-queue/accounts"); revalidatePath("/creator/publishing-queue"); return { ok: true, message: "Platform account reference saved." } }
export async function createCreatorPlatformAccount(_prev: PlatformAccountActionState, formData: FormData) { return persist({ operation: "create", ...fields(formData) }) }
export async function updateCreatorPlatformAccount(_prev: PlatformAccountActionState, formData: FormData) { const parsed = updateAccountIdSchema.safeParse(String(formData.get("accountId") ?? "")); if (!parsed.success) return invalidForm(); return persist({ operation: "update", accountId: parsed.data, ...fields(formData) }) }
