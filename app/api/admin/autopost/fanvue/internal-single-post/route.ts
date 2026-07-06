import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { handleFanvueInternalSinglePostRoute, type FanvueInternalSinglePostJob, type FanvueInternalSinglePostRule } from "@/lib/autopost/fanvueInternalSinglePostRoute"
import type { FanvueInternalAccount } from "@/lib/autopost/fanvueInternalAdapter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACCOUNT_SELECT = [
  "user_id",
  "platform",
  "connection_status",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "token_expires_at",
  "token_type",
  "token_key_version",
  "scopes",
].join(", ")

async function loadJob(jobId: string): Promise<FanvueInternalSinglePostJob | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_jobs")
    .select("id,user_id,rule_id,platform,payload,state,result_status")
    .eq("id", jobId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueInternalSinglePostJob | null
}

async function loadRule(ruleId: string, userId: string): Promise<FanvueInternalSinglePostRule | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_rules")
    .select("id,user_id,approval_state,enabled,selected_platforms,content_payload,paused_at,revoked_at")
    .eq("id", ruleId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueInternalSinglePostRule | null
}

async function loadAccount(userId: string): Promise<FanvueInternalAccount | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_accounts")
    .select(ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueInternalAccount | null
}

async function persistProof(input: { autopostJobId: string; providerPostUuid: string; result: Record<string, unknown>; now: Date }) {
  const completedAt = input.now.toISOString()
  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from("autopost_jobs")
    .update({
      state: "SUCCEEDED",
      result_status: "POSTED",
      platform_post_id: input.providerPostUuid,
      result: input.result,
      error_code: null,
      error_message: null,
      posted_at: completedAt,
      completed_at: completedAt,
      locked_at: null,
      lock_id: null,
    })
    .eq("id", input.autopostJobId)
  if (error) return { ok: false }

  await admin.from("autopost_job_logs").insert({
    job_id: input.autopostJobId,
    level: "info",
    message: "fanvue_internal_single_post_proof_persisted",
    meta: {
      platform: "fanvue",
      result_status: "POSTED",
      provider_post_uuid_present: true,
    },
  })
  return { ok: true }
}

export async function POST(req: Request) {
  const config = requireFanvueOAuthConfig()
  const response = await handleFanvueInternalSinglePostRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    loadJob,
    loadRule,
    loadAccount,
    persistProof,
    adapterDependencies: {
      apiBaseUrl: config.apiBaseUrl,
      apiVersion: config.apiVersion,
      fanvueFetch: (url, init) => fetch(url, init),
      fetchIdentity: (url, init) => fetch(url, init),
      signedPartUploader: async ({ signedUrl, body }) => {
        const upload = await fetch(signedUrl, { method: "PUT", body: body as BodyInit })
        const ETag = upload.headers.get("etag") ?? upload.headers.get("ETag") ?? ""
        if (!upload.ok || !ETag) throw new Error("Signed upload part failed")
        return { ETag }
      },
    },
  })
  return NextResponse.json(response.body, { status: response.status })
}
