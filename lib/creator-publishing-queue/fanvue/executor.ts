/**
 * Server-owned immediate Fanvue executor. Callers must prepare this envelope from
 * canonical CPQ and OAuth records; it is deliberately not a browser DTO or route.
 */
import {
  executeFanvueProviderPost,
  fanvueProviderBaseResult,
  type FanvueProviderAccount,
  type FanvueProviderApprovedContent,
  type FanvueProviderPostInput,
  type FanvueProviderPostResult,
} from "../../autopost/fanvueProviderExecutorCore"

export type PreparedFanvueDestination = Readonly<{
  id: string
  creator_id: string
  platform: "fanvue"
  oauth_account_id: string
}>

export type PreparedFanvueOAuthAccount = FanvueProviderAccount & Readonly<{
  id: string
  user_id: string
  platform: "fanvue"
}>

export type PreparedFanvueExecutionEnvelope = Readonly<{
  creatorId: string
  destination: PreparedFanvueDestination
  oauthAccount: PreparedFanvueOAuthAccount
  approvedContent: FanvueProviderApprovedContent
  provider: Pick<FanvueProviderPostInput, "apiBaseUrl" | "apiVersion" | "fanvueFetch" | "fetchIdentity" | "signedPartUploader" | "decryptAccessToken" | "refreshAccessToken" | "reloadAccountAfterRefresh" | "now" | "waitForMediaReady">
}>

export type FanvueCpqExecutionResult = FanvueProviderPostResult

function rejected(content: FanvueProviderApprovedContent, safe_code: string): FanvueCpqExecutionResult {
  return fanvueProviderBaseResult({
    safe_code,
    content_type: content?.content_type ?? null,
    text_present: typeof content?.text === "string" && content.text.trim().length > 0,
    media_asset_present: Boolean(content?.media),
  })
}

export async function executePreparedFanvuePublication(envelope: PreparedFanvueExecutionEnvelope): Promise<FanvueCpqExecutionResult> {
  const { creatorId, destination, oauthAccount, approvedContent, provider } = envelope
  if (destination.platform !== "fanvue" || oauthAccount.platform !== "fanvue" || approvedContent.platform !== "fanvue") {
    return rejected(approvedContent, "FANVUE_CPQ_PLATFORM_INVALID")
  }
  if (destination.creator_id !== creatorId || oauthAccount.user_id !== creatorId || destination.oauth_account_id !== oauthAccount.id) {
    return rejected(approvedContent, "FANVUE_CPQ_DESTINATION_ACCOUNT_MISMATCH")
  }
  return executeFanvueProviderPost({ userId: creatorId, account: oauthAccount, content: approvedContent, ...provider })
}
