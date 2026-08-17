import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { AI_TWIN_CONSENT_VERSION } from "../consent/copy"
import { getAiTwinConsentTextSha256 } from "../consent/hash"
import { cancelPlanCore, schedulePlanCore } from "./serviceCore"
import { cancelFanvueDirectPlanCore, scheduleFanvueDirectPlanCore } from "./fanvueDirect"
import type { SafeMutationResult } from "./types"
async function creatorId(){ const s=await supabaseServer(); const {data,error}=await s.auth.getUser(); if(error||!data.user?.id) return null; return data.user.id }
export function httpStatusForScheduling(code:string){ if(code==="UNAUTHENTICATED") return 401; if(code==="SCHEDULING_CONFLICT") return 409; if(code==="SCHEDULING_SERVICE_UNAVAILABLE") return 503; if(code==="SCHEDULING_TRUSTED_RESPONSE_INVALID") return 502; if(code==="SCHEDULED"||code==="SCHEDULED_IDEMPOTENT"||code==="CANCELLED"||code==="CANCELLED_IDEMPOTENT") return 200; return 400 }
const deps={getAuthenticatedCreatorId:creatorId,getAdminClient:()=>getSupabaseAdmin(),getConsent:async()=>({version:AI_TWIN_CONSENT_VERSION,textSha256:getAiTwinConsentTextSha256()})}
export async function scheduleCreatorPublishingPlan(input:unknown):Promise<SafeMutationResult>{
  const platformJobId=input&&typeof input==="object"&&!Array.isArray(input)?(input as Record<string,unknown>).platformJobId:null
  if(typeof platformJobId==="string"){
    try{ const {data}=await getSupabaseAdmin().from("creator_publishing_platform_jobs").select("target_platform").eq("id",platformJobId).maybeSingle(); if(data?.target_platform==="fanvue") return scheduleFanvueDirectPlanCore(input,deps) }catch{}
  }
  return schedulePlanCore(input,deps)
}
export async function cancelCreatorPublishingPlanSchedule(input:unknown):Promise<SafeMutationResult>{
  const publishingPlanId=input&&typeof input==="object"&&!Array.isArray(input)?(input as Record<string,unknown>).publishingPlanId:null
  if(typeof publishingPlanId==="string"){
    try{ const {data}=await getSupabaseAdmin().from("creator_publishing_platform_jobs").select("target_platform").eq("publishing_plan_id",publishingPlanId).limit(1).maybeSingle(); if(data?.target_platform==="fanvue") return cancelFanvueDirectPlanCore(input,deps) }catch{}
  }
  return cancelPlanCore(input,deps)
}
