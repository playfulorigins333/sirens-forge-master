"use server"

import { revalidatePath } from "next/cache"
import { claimOnlyFansOperatorTask, recoverExpiredOnlyFansOperatorClaim, releaseOnlyFansOperatorTask, updateOnlyFansOperatorProgress, type OperatorClaimInput, type OperatorMutationResult, type OperatorProgressInput, type OperatorRecoverExpiredClaimInput, type OperatorReleaseInput } from "@/lib/creator-publishing-queue/operator-queue"
import { formDataToForwardedObject, trustedSuccessRevalidationPaths } from "./presentation"

type AnyMutation = OperatorMutationResult<{ platformJobId: string }>
function revalidateTrustedSuccess(result: AnyMutation) { for (const path of trustedSuccessRevalidationPaths(result)) revalidatePath(path) }
export async function claimOnlyFansOperatorTaskAction(_previousState: AnyMutation | null, formData: FormData) { const result = await claimOnlyFansOperatorTask(formDataToForwardedObject(formData) as OperatorClaimInput); if (result.ok === true) revalidateTrustedSuccess(result); return result }
export async function releaseOnlyFansOperatorTaskAction(_previousState: AnyMutation | null, formData: FormData) { const result = await releaseOnlyFansOperatorTask(formDataToForwardedObject(formData) as OperatorReleaseInput); if (result.ok === true) revalidateTrustedSuccess(result); return result }
export async function updateOnlyFansOperatorProgressAction(_previousState: AnyMutation | null, formData: FormData) { const result = await updateOnlyFansOperatorProgress(formDataToForwardedObject(formData, true) as OperatorProgressInput); if (result.ok === true) revalidateTrustedSuccess(result); return result }
export async function recoverExpiredOnlyFansOperatorClaimAction(_previousState: AnyMutation | null, formData: FormData) { const result = await recoverExpiredOnlyFansOperatorClaim(formDataToForwardedObject(formData) as OperatorRecoverExpiredClaimInput); if (result.ok === true) revalidateTrustedSuccess(result); return result }
