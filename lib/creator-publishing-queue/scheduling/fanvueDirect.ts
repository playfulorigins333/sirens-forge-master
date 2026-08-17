import "server-only"
import { normalizeCancelPlanRequest, normalizeSchedulePlanRequest, resolveScheduleLocalDateTime } from "./validation"
import { parseCancelPlanRpcResult } from "./response"
import type { SafeMutationResult } from "./types"

type Deps={getAuthenticatedCreatorId:()=>Promise<string|null>;getAdminClient:()=>any;getConsent:()=>Promise<{version:string;textSha256:string}>;now?:()=>Date}
function fail(code:"UNAUTHENTICATED"|"SCHEDULING_INVALID_REQUEST"|"SCHEDULING_INELIGIBLE"|"SCHEDULING_CONFLICT"|"SCHEDULING_SERVICE_UNAVAILABLE"|"SCHEDULING_TRUSTED_RESPONSE_INVALID",message:string):SafeMutationResult{return{ok:false,code,message}}
function scopesReady(value:unknown){const source=Array.isArray(value)?value:typeof value==="string"?value.split(/\s+/):[];const scopes=new Set(source.map(v=>String(v).trim()).filter(Boolean));return scopes.has("write:post")}
function directResult(data:any,trusted:{planId:string;jobId:string;intended:string;idempotent:boolean}):SafeMutationResult{
 if(!data||typeof data!=="object"||Array.isArray(data)||data.ok!==true||data.action_type!=="schedule"||data.publishing_plan_id!==trusted.planId||data.success_count!==1||data.failure_count!==0||data.idempotent!==trusted.idempotent||!Array.isArray(data.jobs)||data.jobs.length!==1)return fail("SCHEDULING_TRUSTED_RESPONSE_INVALID","Scheduling returned an invalid trusted response.")
 const job=data.jobs[0];const cleanup=job?.operator_claim_cleanup
 if(!job||job.job_id!==trusted.jobId||job.status!=="scheduled"||job.schedule_revision!==1||job.mutated!==true||!cleanup||Object.keys(cleanup).length!==1||cleanup.performed!==false)return fail("SCHEDULING_TRUSTED_RESPONSE_INVALID","Scheduling returned an invalid trusted response.")
 return{ok:true,code:trusted.idempotent?"SCHEDULED_IDEMPOTENT":"SCHEDULED",idempotent:trusted.idempotent,message:trusted.idempotent?"Fanvue schedule already confirmed safely.":"Fanvue schedule confirmed.",publishingPlanId:trusted.planId,platformJobId:trusted.jobId,intendedPublishAtUtc:trusted.intended,operatorClaimCleared:false}
}
export async function scheduleFanvueDirectPlanCore(input:unknown,deps:Deps):Promise<SafeMutationResult>{
 const creatorId=await deps.getAuthenticatedCreatorId();if(!creatorId)return fail("UNAUTHENTICATED","Sign in to schedule a plan.")
 let request,time;try{request=normalizeSchedulePlanRequest(input);time=resolveScheduleLocalDateTime(request.localDateTime,request.scheduleTimezone,deps.now?.()??new Date())}catch{return fail("SCHEDULING_INVALID_REQUEST","Scheduling accepts only a valid local date, time, timezone, plan, job, and idempotency key.")}
 const admin=deps.getAdminClient()
 try{
  const [{data:plan,error:planError},{data:job,error:jobError},{data:idem,error:idemError},{data:cap,error:capError}]=await Promise.all([
   admin.from("creator_publishing_plans").select("id,creator_id,status,cancelled_at,registry_version").eq("id",request.publishingPlanId).maybeSingle(),
   admin.from("creator_publishing_platform_jobs").select("id,creator_id,publishing_plan_id,platform_account_id,target_platform,publishing_mode,job_state,schedule_revision,intended_publish_at,schedule_timezone,cancelled_at,capability_registry_version,oauth_account_id").eq("id",request.platformJobId).maybeSingle(),
   admin.from("creator_publishing_scheduler_idempotency").select("creator_id,publishing_plan_id,action_type,idempotency_key").eq("creator_id",creatorId).eq("action_type","schedule").eq("idempotency_key",request.idempotencyKey).maybeSingle(),
   admin.from("creator_publishing_platform_capabilities").select("platform,registry_version,publishing_mode,availability_status,connector_can_publish_immediately,human_publishing_required").eq("platform","fanvue").maybeSingle(),
  ])
  if(planError||jobError||idemError||capError)return fail("SCHEDULING_SERVICE_UNAVAILABLE","Scheduling is temporarily unavailable.")
  if(!plan||!job||plan.creator_id!==creatorId||job.creator_id!==creatorId||job.publishing_plan_id!==plan.id||job.target_platform!=="fanvue"||job.publishing_mode!=="direct"||job.cancelled_at||plan.cancelled_at)return fail("SCHEDULING_INELIGIBLE","This Fanvue plan is no longer eligible for direct scheduling.")
  if(!cap||cap.registry_version!==plan.registry_version||cap.registry_version!==job.capability_registry_version||cap.publishing_mode!=="direct"||cap.availability_status!=="available"||cap.connector_can_publish_immediately!==true||cap.human_publishing_required!==false)return fail("SCHEDULING_INELIGIBLE","Fanvue direct publishing is not active for this plan.")
  const {data:destination,error:destinationError}=await admin.from("creator_platform_accounts").select("id,creator_id,platform,oauth_account_id").eq("id",job.platform_account_id).maybeSingle();if(destinationError)return fail("SCHEDULING_SERVICE_UNAVAILABLE","Scheduling is temporarily unavailable.")
  if(!destination||destination.creator_id!==creatorId||destination.platform!=="fanvue"||destination.oauth_account_id!==job.oauth_account_id)return fail("SCHEDULING_INELIGIBLE","The Fanvue destination is no longer connected.")
  const {data:oauth,error:oauthError}=await admin.from("autopost_accounts").select("id,user_id,platform,connection_status,provider_account_id,encrypted_access_token,scopes").eq("id",destination.oauth_account_id).maybeSingle();if(oauthError)return fail("SCHEDULING_SERVICE_UNAVAILABLE","Scheduling is temporarily unavailable.")
  if(!oauth||oauth.user_id!==creatorId||oauth.platform!=="fanvue"||oauth.connection_status!=="CONNECTED"||typeof oauth.provider_account_id!=="string"||!oauth.provider_account_id.trim()||typeof oauth.encrypted_access_token!=="string"||!oauth.encrypted_access_token.trim()||!scopesReady(oauth.scopes))return fail("SCHEDULING_INELIGIBLE","Reconnect Fanvue with publishing permissions before scheduling.")
  const replay=!!idem
  if(replay){if(idem.publishing_plan_id!==plan.id||job.schedule_revision!==1||job.intended_publish_at!==time.intendedPublishAtUtc||job.schedule_timezone!==time.scheduleTimezone)return fail("SCHEDULING_CONFLICT","This schedule cannot be replayed safely with that idempotency key.")}
  else if(plan.status!=="draft"||job.job_state!=="draft"||job.schedule_revision!==null||job.intended_publish_at!==null||job.schedule_timezone!==null)return fail("SCHEDULING_INELIGIBLE","This Fanvue plan is no longer an unscheduled draft.")
  const consent=await deps.getConsent()
  const {data,error}=await admin.rpc("creator_publishing_schedule_plan",{p_creator_id:creatorId,p_publishing_plan_id:plan.id,p_intended_publish_at:time.intendedPublishAtUtc,p_schedule_timezone:time.scheduleTimezone,p_idempotency_key:request.idempotencyKey,p_expected_ai_twin_consent_version:consent.version,p_expected_ai_twin_consent_text_sha256:consent.textSha256,p_target_job_ids:[job.id],p_expected_schedule_revisions:{},p_action_type:"schedule"})
  if(error)return fail(/IDEMPOTENCY|CONFLICT|STALE/.test(String(error.message??error.code??""))?"SCHEDULING_CONFLICT":"SCHEDULING_INELIGIBLE","Fanvue scheduling could not be confirmed safely.")
  return directResult(data,{planId:plan.id,jobId:job.id,intended:time.intendedPublishAtUtc,idempotent:replay})
 }catch{return fail("SCHEDULING_SERVICE_UNAVAILABLE","Scheduling is temporarily unavailable.")}
}

const terminal=new Set(["published_direct","confirmed_posted_manual","exported","failed_manual_upload","direct_publish_failed","skipped","blocked","platform_rejected","archived"])
export async function cancelFanvueDirectPlanCore(input:unknown,deps:Deps):Promise<SafeMutationResult>{
 const creatorId=await deps.getAuthenticatedCreatorId();if(!creatorId)return fail("UNAUTHENTICATED","Sign in to cancel a plan.")
 let request;try{request=normalizeCancelPlanRequest(input)}catch{return fail("SCHEDULING_INVALID_REQUEST","Cancellation accepts only a plan, reason, and idempotency key.")}
 const admin=deps.getAdminClient()
 try{
  const [{data:plan,error:planError},{data:jobs,error:jobsError},{data:idem,error:idemError}]=await Promise.all([
   admin.from("creator_publishing_plans").select("id,creator_id,status,cancelled_at,cancellation_reason").eq("id",request.publishingPlanId).maybeSingle(),
   admin.from("creator_publishing_platform_jobs").select("id,creator_id,publishing_plan_id,target_platform,publishing_mode,job_state,cancelled_at").eq("publishing_plan_id",request.publishingPlanId),
   admin.from("creator_publishing_scheduler_idempotency").select("creator_id,publishing_plan_id,action_type,idempotency_key").eq("creator_id",creatorId).eq("action_type","cancel_plan").eq("idempotency_key",request.idempotencyKey).maybeSingle(),
  ])
  if(planError||jobsError||idemError)return fail("SCHEDULING_SERVICE_UNAVAILABLE","Cancellation is temporarily unavailable.")
  if(!plan||plan.creator_id!==creatorId||!Array.isArray(jobs)||jobs.length!==1)return fail("SCHEDULING_INELIGIBLE","This Fanvue plan cannot be cancelled.")
  const job=jobs[0]
  if(job.creator_id!==creatorId||job.publishing_plan_id!==plan.id||job.target_platform!=="fanvue"||job.publishing_mode!=="direct")return fail("SCHEDULING_INELIGIBLE","This Fanvue plan cannot be cancelled.")
  const replay=!!idem
  if(replay){if(idem.publishing_plan_id!==plan.id||plan.status!=="cancelled"||plan.cancellation_reason!==request.cancellationReason)return fail("SCHEDULING_CONFLICT","This cancellation cannot be replayed safely with that idempotency key.")}
  else if(plan.status==="cancelled"||terminal.has(job.job_state)||job.cancelled_at)return fail("SCHEDULING_INELIGIBLE","This Fanvue plan can no longer be cancelled.")
  const {data,error}=await admin.rpc("creator_publishing_cancel_plan_schedule",{p_creator_id:creatorId,p_publishing_plan_id:plan.id,p_cancellation_reason:request.cancellationReason,p_idempotency_key:request.idempotencyKey})
  if(error)return fail(/IDEMPOTENCY|CONFLICT/.test(String(error.message??error.code??""))?"SCHEDULING_CONFLICT":"SCHEDULING_INELIGIBLE","Fanvue cancellation could not be confirmed safely.")
  return parseCancelPlanRpcResult(data,{planId:plan.id,idempotent:replay,countBound:0})
 }catch{return fail("SCHEDULING_SERVICE_UNAVAILABLE","Cancellation is temporarily unavailable.")}
}
