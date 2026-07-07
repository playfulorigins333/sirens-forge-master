import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { loadFanvueApprovedMedia, type FanvueApprovedMediaGenerationRow } from "@/lib/autopost/fanvueApprovedMediaLoader"
import { handleFanvueInternalControlledDispatchRoute, type FanvueControlledDispatchAccount, type FanvueControlledDispatchJob, type FanvueControlledDispatchRule } from "@/lib/autopost/fanvueInternalControlledDispatchRoute"

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

async function loadJob(jobId: string): Promise<FanvueControlledDispatchJob | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_jobs")
    .select("id,user_id,rule_id,platform,payload,state,result,error")
    .eq("id", jobId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueControlledDispatchJob | null
}

async function loadRule(ruleId: string, userId: string): Promise<FanvueControlledDispatchRule | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_rules")
    .select("id,user_id,approval_state,enabled,selected_platforms,content_payload,paused_at,revoked_at")
    .eq("id", ruleId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueControlledDispatchRule | null
}

async function loadAccount(userId: string): Promise<FanvueControlledDispatchAccount | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_accounts")
    .select(ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueControlledDispatchAccount | null
}

async function loadGeneration(input: { userId: string; assetId: string }): Promise<FanvueApprovedMediaGenerationRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("generations")
    .select("id,user_id,status,job_type,mode,metadata,r2_bucket,r2_key")
    .eq("id", input.assetId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as FanvueApprovedMediaGenerationRow | null
}

async function persistProof(input: { autopostJobId: string; providerPostUuid: string; result: Record<string, unknown>; now: Date }) {
  const completedAt = input.now.toISOString()
  const admin = getSupabaseAdmin()
  const { data: updatedJob, error } = await admin
    .from("autopost_jobs")
    .update({
      state: "SUCCEEDED",
      result: {
        ...input.result,
        platform: "fanvue",
        result_status: "POSTED",
        provider_post_uuid_present: true,
        posted_at: completedAt,
        completed_at: completedAt,
        price_used: false,
        publishAt_used: false,
        dispatch_attempted: false,
        schedule_attempted: false,
        platform_registry_changed: false,
        public_ui_added: false,
      },
      error: null,
      updated_at: completedAt,
    })
    .eq("id", input.autopostJobId)
    .eq("state", "QUEUED")
    .select("id")
    .maybeSingle()
  if (error || !updatedJob) return { ok: false, job_proof_persisted: false, audit_log_persisted: false }

  const { error: logError } = await admin.from("autopost_job_logs").insert({
    job_id: input.autopostJobId,
    level: "INFO",
    message: "fanvue_controlled_live_dispatch_posted",
    meta: {
      platform: "fanvue",
      route: "internal-controlled-dispatch",
      operation: "fanvue_internal_controlled_dispatch_live_single_post_no_price_no_schedule_no_retry",
      result_status: "POSTED",
      provider_post_uuid_present: true,
      controlled_live_dispatch: true,
      dry_run: false,
      single_autopost_job_id: true,
      price_used: false,
      publishAt_used: false,
      schedule_attempted: false,
      dispatch_attempted: false,
      platform_registry_changed: false,
      public_ui_added: false,
    },
  })
  if (logError) return { ok: false, job_proof_persisted: true, audit_log_persisted: false }
  return { ok: true, job_proof_persisted: true, audit_log_persisted: true }
}

export async function POST(req: Request) {
  const response = await handleFanvueInternalControlledDispatchRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    env: process.env,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    loadJob,
    loadRule,
    loadAccount,
    loadApprovedMedia: ({ userId, sourceAssetIds }) => loadFanvueApprovedMedia({ userId, sourceAssetIds, loadGeneration }),
    persistProof,
    getAdapterDependencies: () => {
      const config = requireFanvueOAuthConfig()
      return {
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
      }
    },
  })
  return NextResponse.json(response.body, { status: response.status })
}
