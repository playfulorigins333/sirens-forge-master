import "server-only"
import { randomUUID } from "node:crypto"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { normalizeAutopostPlanRequest } from "./validation"
import { parseCreateAutopostPlanRpcResult, toSafeCapabilities } from "./response"
import { validateAutopostGeneratedMediaFacts } from "./sourceFingerprint"
import type { AutopostPlanRequest, AutopostPlanResult, SafeCapability, AutopostPackageOption } from "./types"

type Deps = { getAuthenticatedUserId?:()=>Promise<string|null>; getAdminClient?:()=>any; randomUUID?:()=>string }
export const AUTOPOST_SCHEMA_UNAVAILABLE = "AUTOPOST_SCHEMA_UNAVAILABLE"
export function isAutopostSchemaUnavailableError(error:any){ const code=String(error?.code??""); const message=String(error?.message??""); return code === "42P01" || code === "42883" || code === "PGRST202" || /does not exist|schema cache|Could not find the function|relation .* does not exist/i.test(message) }
function autopostSchemaUnavailable(){ return Object.assign(new Error(AUTOPOST_SCHEMA_UNAVAILABLE),{code:AUTOPOST_SCHEMA_UNAVAILABLE}) }
async function defaultCreatorId(){ const supabase=await supabaseServer(); const {data,error}=await supabase.auth.getUser(); if(error||!data.user?.id) return null; return data.user.id }
function admin(deps:Deps){ return deps.getAdminClient?.() ?? getSupabaseAdmin() }
function msg(code:string){ return ({UNAUTHENTICATED:"Sign in to use Autopost orchestration.",AUTOPOST_INVALID_REQUEST:"Autopost accepted only selected package IDs and one idempotency key.",IDEMPOTENCY_CONFLICT:"This idempotency key was already used for different Autopost inputs.",NO_CONTENT_PACKAGES_SELECTED:"Select at least one existing content package.",CONTENT_PACKAGE_NOT_FOUND:"A selected content package could not be found.",FANVUE_NOT_AVAILABLE:"Fanvue scheduled publishing is not active in this environment.",FANVUE_ONE_PACKAGE_PER_PLAN:"Create one Fanvue Publishing Plan at a time.",FANVUE_PUBLICATION_SCOPE_MISSING:"Reconnect Fanvue with the required publishing permissions before creating this plan.",FANVUE_MEDIA_COUNT_INVALID:"Fanvue Publishing Plans support either text only or one attached image/video.",FANVUE_TEXT_REQUIRED:"Add caption text or attach one eligible image/video before creating this Fanvue plan.",FANVUE_MEDIA_TYPE_UNSUPPORTED:"That Fanvue media type is not supported for direct publishing.",PLATFORM_UNAVAILABLE:"That destination is unavailable for active Autopost plan creation.",CAPABILITY_REGISTRY_INCONSISTENT:"Autopost routing is temporarily unavailable.",GENERATED_MEDIA_PROVENANCE_REQUIRED:"Every attached media item must be trusted Sirens Forge generated media.",ACTIVE_PUBLICATION_JOB_CONFLICT:"A selected package already belongs to an active Autopost publication job.",DUPLICATE_DESTINATION_ACCOUNT:"Select only one package for each destination account.",AUTOPOST_SCHEMA_UNAVAILABLE:"Autopost orchestration is temporarily unavailable.",DESTINATION_ACCOUNT_NOT_VERIFIED:"A connected, trusted destination is required before creating a Publishing Plan.",DESTINATION_ACCOUNT_REVOKED:"This platform account reference is revoked and cannot be used to create a Publishing Plan.",AUTOPOST_CREATE_FAILED:"Autopost plan creation failed.",AUTOPOST_MALFORMED_TRUSTED_RESPONSE:"Autopost plan creation returned an invalid trusted response."} as Record<string,string>)[code] ?? "Autopost plan creation failed." }
function codeFromDb(e:any){ const m=String(e?.message??""); for(const c of ["IDEMPOTENCY_CONFLICT","NO_CONTENT_PACKAGES_SELECTED","CONTENT_PACKAGE_NOT_FOUND","FANVUE_NOT_AVAILABLE","FANVUE_PUBLICATION_SCOPE_MISSING","FANVUE_MEDIA_COUNT_INVALID","FANVUE_TEXT_REQUIRED","FANVUE_MEDIA_TYPE_UNSUPPORTED","PLATFORM_UNAVAILABLE","CAPABILITY_REGISTRY_INCONSISTENT","GENERATED_MEDIA_PROVENANCE_REQUIRED","ACTIVE_PUBLICATION_JOB_CONFLICT","DUPLICATE_DESTINATION_ACCOUNT","DESTINATION_ACCOUNT_NOT_VERIFIED","DESTINATION_ACCOUNT_REVOKED","UNAUTHENTICATED",AUTOPOST_SCHEMA_UNAVAILABLE]) if(m.includes(c)) return c; if(isAutopostSchemaUnavailableError(e)) return AUTOPOST_SCHEMA_UNAVAILABLE; return "AUTOPOST_CREATE_FAILED" }
export function httpStatusForAutopostError(code:string){ if(code==="UNAUTHENTICATED") return 401; if(["IDEMPOTENCY_CONFLICT","ACTIVE_PUBLICATION_JOB_CONFLICT","DUPLICATE_DESTINATION_ACCOUNT"].includes(code)) return 409; if(code===AUTOPOST_SCHEMA_UNAVAILABLE) return 503; if(["AUTOPOST_CREATE_FAILED","AUTOPOST_MALFORMED_TRUSTED_RESPONSE","CAPABILITY_REGISTRY_INCONSISTENT"].includes(code)) return 500; return 400 }
export async function requireAutopostCreatorId(deps:Deps={}): Promise<string|null>{ return (deps.getAuthenticatedUserId ?? defaultCreatorId)() }
export async function loadAutopostCapabilities(deps:Deps={}):Promise<SafeCapability[]>{ const creatorId=await requireAutopostCreatorId(deps); if(!creatorId) throw Object.assign(new Error("UNAUTHENTICATED"),{code:"UNAUTHENTICATED"}); const {data,error}=await admin(deps).from("creator_publishing_platform_capability_public").select("platform,registry_version,display_name,publishing_mode,availability_status,human_publishing_required,connector_can_publish_immediately,connector_can_schedule_directly,connector_can_upload_media,human_operator_queue_supported,safe_label,safe_description").order("platform",{ascending:true}); if(error) throw isAutopostSchemaUnavailableError(error) ? autopostSchemaUnavailable() : new Error("Autopost capabilities could not be loaded."); return toSafeCapabilities(data??[]) }
function scopeSet(value:unknown){ const source=Array.isArray(value)?value:typeof value==="string"?value.split(/\s+/):[]; return new Set(source.map(v=>String(v).trim()).filter(Boolean)) }
function fanvueScopesReady(scopes:unknown,media:boolean){ const s=scopeSet(scopes); if(!s.has("write:post")) return false; return !media || ["read:media","write:media","write:creator"].every(scope=>s.has(scope)) }
export async function loadAutopostPackageOptions(deps:Deps={}):Promise<AutopostPackageOption[]>{
  const creatorId=await requireAutopostCreatorId(deps); if(!creatorId) return [];
  const client=admin(deps)
  const [{data,error},{data:fanvueCapability,error:capError}]=await Promise.all([
    client.from("creator_publishing_content_packages").select("id,title,caption_body,target_platform,platform_account_id,updated_at,creator_platform_accounts!creator_publishing_content_platform_account_fk(platform_username,verification_status,oauth_account_id),creator_publishing_media_assets(id,storage_key,mime_type,sha256,source,ai_generation_metadata)").eq("creator_id",creatorId).order("updated_at",{ascending:false}).limit(50),
    client.from("creator_publishing_platform_capabilities").select("platform,publishing_mode,availability_status,connector_can_publish_immediately").eq("platform","fanvue").maybeSingle()
  ])
  if(error||capError) throw isAutopostSchemaUnavailableError(error??capError) ? autopostSchemaUnavailable() : new Error("Autopost package options could not be loaded.")
  const rows=(data??[]) as any[]
  const oauthIds=Array.from(new Set(rows.map(p=>p.creator_platform_accounts?.oauth_account_id).filter((v):v is string=>typeof v==="string"&&v.length>0)))
  const oauthById=new Map<string,any>()
  if(oauthIds.length){ const oauth=await client.from("autopost_accounts").select("id,user_id,platform,connection_status,provider_account_id,encrypted_access_token,scopes").in("id",oauthIds); if(oauth.error) throw new Error("Autopost package options could not be loaded."); for(const row of oauth.data??[]) oauthById.set(row.id,row) }
  const fanvueAvailable=fanvueCapability?.publishing_mode==="direct"&&fanvueCapability?.availability_status==="available"&&fanvueCapability?.connector_can_publish_immediately===true
  return rows.map(p=>{
    const media=p.creator_publishing_media_assets??[]
    const destination=p.creator_platform_accounts
    if(p.target_platform==="fanvue"){
      const oauth=destination?.oauth_account_id?oauthById.get(destination.oauth_account_id):null
      const connected=!!oauth&&oauth.user_id===creatorId&&oauth.platform==="fanvue"&&oauth.connection_status==="CONNECTED"&&typeof oauth.provider_account_id==="string"&&oauth.provider_account_id.trim().length>0&&typeof oauth.encrypted_access_token==="string"&&oauth.encrypted_access_token.trim().length>0
      const mediaShapeOk=media.length===0?(typeof p.caption_body==="string"&&p.caption_body.trim().length>0):media.length===1&&validateAutopostGeneratedMediaFacts(media)
      const scopesReady=connected&&fanvueScopesReady(oauth.scopes,media.length===1)
      const eligible=fanvueAvailable&&connected&&mediaShapeOk&&scopesReady
      const blockedReason=!fanvueAvailable?"Fanvue scheduled publishing is not active in this environment.":!connected?"Connect Fanvue before creating a Publishing Plan.":media.length>1?"Fanvue plans support one attached image/video at a time.":!mediaShapeOk?"Add caption text or attach one trusted Sirens Forge image/video before creating a plan.":!scopesReady?"Reconnect Fanvue with the required publishing permissions.":null
      return {id:p.id,title:p.title,targetPlatform:p.target_platform,platformAccountId:p.platform_account_id,platformUsername:destination?.platform_username??oauth?.provider_account_id??"connected",updatedAt:p.updated_at,eligible,blockedReason}
    }
    const mediaOk=validateAutopostGeneratedMediaFacts(media); const destinationStatus=destination?.verification_status; const destinationVerified=destinationStatus === "verified"; const destinationMissing=!destination || typeof destinationStatus !== "string"; return {id:p.id,title:p.title,targetPlatform:p.target_platform,platformAccountId:p.platform_account_id,platformUsername:destination?.platform_username??"unknown",updatedAt:p.updated_at,eligible:mediaOk&&destinationVerified,blockedReason:!mediaOk?"Attach trusted Sirens Forge generated media before creating a plan.":destinationStatus === "revoked"?"This platform account reference is revoked and cannot be used to create a Publishing Plan.":destinationMissing || !destinationVerified?"Sirens Forge trusted verification is required before creating a Publishing Plan.":null}
  })
}
export async function createAutopostPlan(input:AutopostPlanRequest, deps:Deps={}):Promise<AutopostPlanResult>{
  const creatorId=await requireAutopostCreatorId(deps); if(!creatorId) return {ok:false,code:"UNAUTHENTICATED",message:msg("UNAUTHENTICATED")}; let n; try{ n=normalizeAutopostPlanRequest(input); }catch(e:any){ const code=e.code??"AUTOPOST_INVALID_REQUEST"; return {ok:false,code,message:msg(code)} }
  const client=admin(deps)
  const {data:packageRows,error:packageError}=await client.from("creator_publishing_content_packages").select("id,target_platform").eq("creator_id",creatorId).in("id",n.contentPackageIds)
  if(packageError) return {ok:false,code:"AUTOPOST_CREATE_FAILED",message:msg("AUTOPOST_CREATE_FAILED")}
  const trustedRows=packageRows??[]
  const platforms=new Set(trustedRows.map((row:any)=>row.target_platform))
  if(trustedRows.length!==n.contentPackageIds.length) return {ok:false,code:"CONTENT_PACKAGE_NOT_FOUND",message:msg("CONTENT_PACKAGE_NOT_FOUND")}
  if(platforms.has("fanvue")){
    if(platforms.size!==1||n.contentPackageIds.length!==1) return {ok:false,code:"FANVUE_ONE_PACKAGE_PER_PLAN",message:msg("FANVUE_ONE_PACKAGE_PER_PLAN")}
    const {data,error}=await client.rpc("creator_publishing_create_fanvue_autopost_plan",{p_creator_id:creatorId,p_content_package_id:n.contentPackageIds[0],p_idempotency_key:n.idempotencyKey || (deps.randomUUID ?? randomUUID)()}); if(error){ const code=codeFromDb(error); return {ok:false,code,message:msg(code)} } try{return parseCreateAutopostPlanRpcResult(data,creatorId,n.contentPackageIds)}catch{return {ok:false,code:"AUTOPOST_MALFORMED_TRUSTED_RESPONSE",message:msg("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")}}
  }
  const {data,error}=await client.rpc("creator_publishing_create_autopost_plan",{p_creator_id:creatorId,p_content_package_ids:n.contentPackageIds,p_idempotency_key:n.idempotencyKey || (deps.randomUUID ?? randomUUID)()}); if(error){ const code=codeFromDb(error); return {ok:false,code,message:msg(code)} } try { return parseCreateAutopostPlanRpcResult(data, creatorId, n.contentPackageIds) } catch { return {ok:false,code:"AUTOPOST_MALFORMED_TRUSTED_RESPONSE",message:msg("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")} }
}
