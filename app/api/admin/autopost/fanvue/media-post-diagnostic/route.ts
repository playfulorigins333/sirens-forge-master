import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { handleFanvueMediaPostDiagnosticRoute, type FanvueMediaPostDiagnosticAccount } from "@/lib/autopost/fanvueMediaPostDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_MEDIA_POST_DIAGNOSTIC_ACCOUNT_SELECT = [
  "user_id",
  "platform",
  "connection_status",
  "provider_account_id",
  "provider_username",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "token_expires_at",
  "token_type",
  "token_key_version",
  "scopes",
  "metadata",
].join(", ")

async function loadFanvueMediaPostDiagnosticAccount(userId: string): Promise<FanvueMediaPostDiagnosticAccount | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_MEDIA_POST_DIAGNOSTIC_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as FanvueMediaPostDiagnosticAccount | null
}

export async function POST(req: Request) {
  const config = requireFanvueOAuthConfig()
  const response = await handleFanvueMediaPostDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createLoadAccount: () => loadFanvueMediaPostDiagnosticAccount,
    fetchIdentity: (url, init) => fetch(url, init),
    fanvueFetch: (url, init) => fetch(url, init),
    signedPartUploader: async ({ signedUrl, body }) => {
      const upload = await fetch(signedUrl, { method: "PUT", body: body as BodyInit })
      const ETag = upload.headers.get("etag") ?? upload.headers.get("ETag") ?? ""
      if (!upload.ok || !ETag) throw new Error("Signed upload part failed")
      return { ETag }
    },
    apiBaseUrl: config.apiBaseUrl,
    apiVersion: config.apiVersion,
  })
  return NextResponse.json(response.body, { status: response.status })
}
