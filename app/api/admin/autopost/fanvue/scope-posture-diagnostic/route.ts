import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { handleFanvueScopePostureDiagnosticRoute, type FanvueScopePostureAccount } from "@/lib/autopost/fanvueScopePostureDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_SCOPE_POSTURE_CONNECTION_STATUS_SELECT = ["user_id", "platform", "connection_status", "scopes"].join(", ")
const FANVUE_SCOPE_POSTURE_STATUS_SELECT = ["user_id", "platform", "status", "scopes"].join(", ")
const UNAVAILABLE_COLUMN_RE = /column|schema cache|does not exist|could not find/i

function isUnavailableStatusColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === "string" ? record.code : ""
  const message = [record.message, record.details, record.hint].filter((value): value is string => typeof value === "string").join(" ")
  return code === "42703" || code === "PGRST204" || UNAVAILABLE_COLUMN_RE.test(message)
}

async function selectFanvueScopePostureAccounts(userId: string, selectColumns: string): Promise<FanvueScopePostureAccount[]> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(selectColumns)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .limit(2)
  if (error) throw error
  return (data ?? []) as FanvueScopePostureAccount[]
}

async function loadFanvueScopePostureAccounts(userId: string): Promise<FanvueScopePostureAccount[]> {
  try {
    return await selectFanvueScopePostureAccounts(userId, FANVUE_SCOPE_POSTURE_CONNECTION_STATUS_SELECT)
  } catch (error) {
    if (!isUnavailableStatusColumnError(error)) throw error
  }

  return selectFanvueScopePostureAccounts(userId, FANVUE_SCOPE_POSTURE_STATUS_SELECT)
}

export async function POST(req: Request) {
  const response = await handleFanvueScopePostureDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    loadAccounts: loadFanvueScopePostureAccounts,
  })
  return NextResponse.json(response.body, { status: response.status })
}
