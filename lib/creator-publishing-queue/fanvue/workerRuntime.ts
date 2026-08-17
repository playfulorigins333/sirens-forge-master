import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { requireFanvueOAuthConfig } from "../../autopost/fanvueOAuth"
import { decryptAutopostToken } from "../../autopost/tokenCryptoCore"
import { refreshFanvueAccessToken } from "../../autopost/fanvueTokenRefresh"
import { GENERATED_MEDIA_BUCKET } from "../media/generatedMediaCore"
import { runDormantFanvueCpqWorker } from "./service"

const BATCH_SIZE = 1

async function reloadFanvueAccount(userId:string){
  const {data,error}=await getSupabaseAdmin().from("autopost_accounts").select("user_id,platform,connection_status,encrypted_access_token,encrypted_refresh_token,token_expires_at,token_type,token_key_version,scopes").eq("user_id",userId).eq("platform","fanvue").maybeSingle()
  if(error) return null
  return data??null
}

async function loadMediaBytes(asset:{storage_key:string}){
  const {data,error}=await getSupabaseAdmin().storage.from(GENERATED_MEDIA_BUCKET).download(asset.storage_key)
  if(error||!data) throw new Error("FANVUE_CPQ_MEDIA_BYTES_UNAVAILABLE")
  return Buffer.from(await data.arrayBuffer())
}

export function fanvueWorkerEnabled(){
  return process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED === "true" && process.env.FANVUE_CPQ_WORKER_ENABLED === "true"
}

export async function runProductionFanvueCpqWorker(){
  if(!fanvueWorkerEnabled()) return {claimed:0,succeeded:0,retryScheduled:0,failed:0,reconnectRequired:0,uncertain:0}
  const config=requireFanvueOAuthConfig()
  return runDormantFanvueCpqWorker({
    enabled:true,
    batchSize:BATCH_SIZE,
    dependencies:{
      provider:{
        apiBaseUrl:config.apiBaseUrl,
        apiVersion:config.apiVersion,
        fanvueFetch:(url,init)=>fetch(url,init),
        fetchIdentity:(url,init)=>fetch(url,init),
        signedPartUploader:async({signedUrl,body,contentType})=>{
          const headers=contentType?{"Content-Type":contentType}:undefined
          const response=await fetch(signedUrl,{method:"PUT",body:body as BodyInit,headers})
          const ETag=response.headers.get("etag")??response.headers.get("ETag")??""
          if(!response.ok||!ETag) throw new Error("FANVUE_SIGNED_UPLOAD_FAILED")
          return {ETag}
        },
        decryptAccessToken:decryptAutopostToken,
        refreshAccessToken:(account)=>refreshFanvueAccessToken({
          user_id:String(account.user_id),
          platform:String(account.platform),
          encrypted_refresh_token:account.encrypted_refresh_token??null,
          token_expires_at:account.token_expires_at??null,
          token_type:account.token_type??null,
          token_key_version:account.token_key_version??null,
          scopes:account.scopes??null,
        }),
        reloadAccountAfterRefresh:reloadFanvueAccount,
      },
      loadMediaBytes,
    },
  })
}
