"use server"
import { revalidatePath } from "next/cache"
import { completeOnlyFansManualPostFromFormData } from "@/lib/creator-publishing-queue/operator-completion"
export async function completeOnlyFansManualPostAction(_prev: unknown, formData: FormData) { const trusted = new FormData(); for (const [k,v] of formData.entries()) if (!k.startsWith("$ACTION_")) trusted.append(k,v); const result = await completeOnlyFansManualPostFromFormData(trusted); if (result.ok) { revalidatePath("/creator/publishing-queue/operator"); revalidatePath("/creator/publishing-queue"); revalidatePath(`/creator/publishing-queue/operator/${result.data.platformJobId}`) } return result }
