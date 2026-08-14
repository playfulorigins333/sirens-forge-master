import {
  executeFanvueProviderPost,
  redactFanvueProviderPostResult,
  type FanvueProviderAccount,
  type FanvueProviderApprovedContent,
  type FanvueProviderApprovedMedia,
  type FanvueProviderContentType,
  type FanvueProviderPostInput,
  type FanvueProviderPostResult,
  type FanvueProviderReadinessFinalState,
  type FanvueProviderReadinessStatusClass,
  type FanvueProviderRefreshStatusClass,
  type FanvueProviderStatusClass,
} from "./fanvueProviderExecutorCore"

export const FANVUE_INTERNAL_SINGLE_POST_AUDIENCE = "subscribers" as const
export const FANVUE_INTERNAL_SINGLE_POST_ROUTE = "/api/admin/autopost/fanvue/internal-single-post" as const
export const FANVUE_INTERNAL_SINGLE_POST_OPERATION = "fanvue_internal_single_post_approved_content_no_price_no_schedule_no_dispatch" as const
export const FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION = "REQUEST_FANVUE_INTERNAL_SINGLE_POST_ONLY_APPROVED_CONTENT_NO_PRICE_NO_SCHEDULE_NO_DISPATCH" as const

export type FanvueInternalContentType = FanvueProviderContentType
export type FanvueInternalStatusClass = FanvueProviderStatusClass
export type FanvueInternalReadinessStatusClass = FanvueProviderReadinessStatusClass
export type FanvueInternalReadinessFinalState = FanvueProviderReadinessFinalState
export type FanvueInternalRefreshStatusClass = FanvueProviderRefreshStatusClass
export type FanvueInternalAccount = FanvueProviderAccount
export type FanvueInternalApprovedMedia = FanvueProviderApprovedMedia
export type FanvueInternalApprovedContent = FanvueProviderApprovedContent
export type FanvueInternalPostInput = FanvueProviderPostInput
export type FanvueInternalPostResult = FanvueProviderPostResult

function internalSafeCode(code: string) {
  if (code === "FANVUE_EXECUTION_CREATED") return "FANVUE_INTERNAL_SINGLE_POST_CREATED"
  if (code === "FANVUE_EXECUTION_NOT_ATTEMPTED") return "FANVUE_INTERNAL_SINGLE_POST_NOT_ATTEMPTED"
  return code.replace(/^FANVUE_EXECUTION_/, "FANVUE_INTERNAL_")
}

export async function postFanvueInternalSinglePost(input: FanvueInternalPostInput): Promise<FanvueInternalPostResult> {
  const result = await executeFanvueProviderPost(input)
  return { ...result, safe_code: internalSafeCode(result.safe_code) }
}

export function redactFanvueInternalPostResult(result: FanvueInternalPostResult): Omit<FanvueInternalPostResult, "provider_post_uuid" | "safe_error_message"> {
  return redactFanvueProviderPostResult(result)
}
