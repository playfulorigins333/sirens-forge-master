"use server"
import { revalidatePath } from "next/cache"
import { normalizeAiTwinConsentFormInput } from "@/lib/creator-publishing-queue/consent/serviceCore"
import { saveAiTwinConsent } from "@/lib/creator-publishing-queue/consent/service"
export type AiTwinConsentActionState = { ok?: boolean; message?: string; code?: string }
export async function submitAiTwinConsent(_prev: AiTwinConsentActionState, formData: FormData): Promise<AiTwinConsentActionState> { const normalized = normalizeAiTwinConsentFormInput(formData.entries()); if (normalized.ok === false) return { ok:false, code:normalized.code, message:normalized.code }; const result = await saveAiTwinConsent(normalized.input); if (result.ok === false) return { ok:false, code:result.code, message:result.message }; revalidatePath("/creator/publishing-queue/ai-twin-consent"); return { ok:true, message:`AI-twin consent ${result.result.outcome}.` } }
