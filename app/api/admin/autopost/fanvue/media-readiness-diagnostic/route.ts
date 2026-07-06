import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { handleFanvueMediaReadinessDiagnosticRoute } from "@/lib/autopost/fanvueMediaReadinessDiagnosticRoute"
import type { FanvueUploadDiagnosticAccount } from "@/lib/autopost/fanvueUploadDiagnostic"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_MEDIA_READINESS_DIAGNOSTIC_ACCOUNT_SELECT = [
  "user_id",
  "platform",
  "connection_status",
  "provider_account_id",
  "provider_username",
  "scopes",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "token_expires_at",
  "token_type",
  "token_key_version",
  "metadata",
].join(", ")

async function loadFanvueMediaReadinessDiagnosticAccount(userId: string): Promise<FanvueUploadDiagnosticAccount | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_MEDIA_READINESS_DIAGNOSTIC_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as FanvueUploadDiagnosticAccount | null
}

export async function POST(req: Request) {
  const config = requireFanvueOAuthConfig()
  const response = await handleFanvueMediaReadinessDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createLoadAccount: () => loadFanvueMediaReadinessDiagnosticAccount,
    apiBaseUrl: config.apiBaseUrl,
    apiVersion: config.apiVersion,
    fetchIdentity: (url, init) => fetch(url, init),
    fanvueFetch: (url, init) => fetch(url, init),
    signedPartUploader: async ({ signedUrl, body }) => {
      const upload = await fetch(signedUrl, { method: "PUT", body: body as BodyInit })
      if (!upload.ok) throw new Error("FANVUE_SIGNED_PART_UPLOAD_FAILED")
      return { ETag: upload.headers.get("ETag") ?? "" }
    },
  })
  return NextResponse.json(response.body, { status: response.status })
}
