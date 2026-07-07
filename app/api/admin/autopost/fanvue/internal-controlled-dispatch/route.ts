import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { loadFanvueApprovedMedia, type FanvueApprovedMediaGenerationRow } from "@/lib/autopost/fanvueApprovedMediaLoader"
import { handleFanvueInternalControlledDispatchRoute, type FanvueControlledDispatchAccount, type FanvueControlledDispatchJob, type FanvueControlledDispatchRule } from "@/lib/autopost/fanvueInternalControlledDispatchRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACCOUNT_SELECT = ["user_id", "platform", "connection_status", "scopes"].join(", ")

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
  })
  return NextResponse.json(response.body, { status: response.status })
}
