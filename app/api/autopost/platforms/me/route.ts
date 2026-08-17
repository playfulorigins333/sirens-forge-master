import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getAutopostPlatformRegistry } from "@/lib/autopost/platformRegistry"
import { buildUserPlatformStatus } from "@/lib/autopost/platformAvailability"
import type { PlatformId } from "@/lib/autopost/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AutopostAccountRow = {
  platform: PlatformId
  provider_account_id: string | null
  provider_username: string | null
  connection_status: string | null
  connected_at: string | null
  last_refresh_at: string | null
  last_error: string | null
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  token_key_version: number | null
  scopes: string[] | string | null
  metadata: Record<string, unknown> | null
}

export async function GET(req: Request) {
  const userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const registry = getAutopostPlatformRegistry()
  const supportedPlatformIds = registry.map((platform) => platform.id)
  const supabaseAdmin = getSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(
      "platform, provider_account_id, provider_username, connection_status, connected_at, last_refresh_at, last_error, encrypted_access_token, encrypted_refresh_token, token_expires_at, token_key_version, scopes, metadata"
    )
    .eq("user_id", userId)
    .in("platform", supportedPlatformIds)

  if (error) {
    return NextResponse.json({ error: "PLATFORM_STATUS_LOOKUP_FAILED" }, { status: 500 })
  }

  const accountsByPlatform = new Map<PlatformId, AutopostAccountRow>()
  for (const account of data ?? []) {
    accountsByPlatform.set(account.platform as PlatformId, account as AutopostAccountRow)
  }

  return NextResponse.json({
    platforms: registry.map((platform) => {
      const status = buildUserPlatformStatus(platform, accountsByPlatform)
      if (platform.id !== "fanvue" || platform.public_selectable !== true) return status

      const ready = status.user_connected === true && status.supports_text_posting === true
      return {
        ...status,
        launch_status: ready ? "available" : status.launch_status,
        public_selectable: ready,
        can_schedule: ready,
        native_posting_available: ready,
        native_posting_blocker: ready ? null : status.native_posting_blocker,
        status_message: ready
          ? "Fanvue is connected and ready for direct scheduled publishing."
          : status.status_message,
        disabled_reason: ready ? null : status.disabled_reason,
        blockers: ready ? [] : status.blockers,
      }
    }),
  })
}
