"use server"
import { revalidatePath } from "next/cache"
import { saveAiTwinConsent } from "@/lib/creator-publishing-queue/consent/service"
export type AiTwinConsentActionState = { ok?: boolean; message?: string; code?: string }
export async function submitAiTwinConsent(_prev: AiTwinConsentActionState, formData: FormData): Promise<AiTwinConsentActionState> { const result = await saveAiTwinConsent({ decision: formData.get("decision") === "revoke" ? "revoke" : "grant", expectedUpdatedAt: formData.get("expectedUpdatedAt")?.toString() || null, idempotencyKey: formData.get("idempotencyKey")?.toString() || "", confirmGrant: formData.get("confirmGrant"), confirmRevoke: formData.get("confirmRevoke") }); if (result.ok === false) return { ok:false, code:result.code, message:result.message }; revalidatePath("/creator/publishing-queue/ai-twin-consent"); return { ok:true, message:`AI-twin consent ${result.result.outcome}.` } }
