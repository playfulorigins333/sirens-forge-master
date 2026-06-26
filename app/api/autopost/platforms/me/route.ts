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
      "platform, provider_account_id, provider_username, connection_status, connected_at, last_refresh_at, last_error"
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
    platforms: registry.map((platform) => buildUserPlatformStatus(platform, accountsByPlatform)),
  })
}
