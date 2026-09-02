import "server-only"
import { randomUUID } from "node:crypto"
import { getSupabaseAdmin } from "../supabaseAdmin"
import { assertCreatorReplyKeyVersion, conversationCheckpointAad, creatorReplyDataKeyVersion, decryptCreatorReplyData, encryptCreatorReplyData, subscriberNotesAad } from "./creator-reply-crypto"
import { CreatorReplyCheckpoint, emptyCreatorReplyCheckpoint, parseCreatorReplyCheckpoint } from "./creator-reply-checkpoint"

const clean = (v: unknown, max: number, required=false) => { const s=typeof v==="string"?v.trim():""; if ((required&&!s)||s.length>max) throw new Error("INVALID_INPUT"); return s }
export async function resolveCreatorReplyWorkspace(userId:string) {
  const db=getSupabaseAdmin()
  const {data,error}=await db.rpc("ensure_creator_reply_workspace",{p_user_id:userId})
  if(error||!data)throw error||new Error("WORKSPACE_UNAVAILABLE");return data as string
}
const checkpoint = (w:string,c:string,value:CreatorReplyCheckpoint) => encryptCreatorReplyData(JSON.stringify(value),conversationCheckpointAad(w,c))
export async function listSubscribers(userId:string, archived=false) {
  const w=await resolveCreatorReplyWorkspace(userId), db=getSupabaseAdmin()
  let q=db.from("sirens_mind_creator_reply_subscribers").select("id,display_name,platform,platform_handle,last_used_at,archived_at,updated_at").eq("workspace_id",w).order("last_used_at",{ascending:false,nullsFirst:false}).order("updated_at",{ascending:false})
  q=archived?q.not("archived_at","is",null):q.is("archived_at",null); const {data,error}=await q; if(error)throw error; return data
}
export async function createSubscriber(userId:string,input:Record<string,unknown>) {
  const w=await resolveCreatorReplyWorkspace(userId), db=getSupabaseAdmin(), sid=randomUUID(), cid=randomUUID(), keyVersion=creatorReplyDataKeyVersion()
  const display_name=clean(input.display_name,120,true), platform=clean(input.platform,80,true), platform_handle=clean(input.platform_handle,120)||null, notes=clean(input.notes,2000)
  const notes_ciphertext=notes?encryptCreatorReplyData(notes,subscriberNotesAad(w,sid)):null
  const checkpoint_ciphertext=checkpoint(w,cid,emptyCreatorReplyCheckpoint())
  const {error:sError}=await db.from("sirens_mind_creator_reply_subscribers").insert({id:sid,workspace_id:w,created_by_user_id:userId,display_name,platform,platform_handle,notes_ciphertext,notes_key_version:notes?keyVersion:null})
  if(sError)throw sError
  const {error:cError}=await db.from("sirens_mind_creator_reply_conversations").insert({id:cid,workspace_id:w,subscriber_id:sid,created_by_user_id:userId,status:"active",checkpoint_ciphertext,checkpoint_key_version:keyVersion})
  if(cError){await db.from("sirens_mind_creator_reply_subscribers").delete().eq("workspace_id",w).eq("id",sid);throw cError}
  return {subscriber:{id:sid,display_name,platform,platform_handle},conversation:{id:cid,status:"active",label:""}}
}
export async function getSubscriber(userId:string,id:string){const {w,data}=await ownedSubscriber(userId,id);let notes="";if(data.notes_ciphertext){assertCreatorReplyKeyVersion(data.notes_key_version);notes=decryptCreatorReplyData(data.notes_ciphertext,subscriberNotesAad(w,id))}return{id:data.id,display_name:data.display_name,platform:data.platform,platform_handle:data.platform_handle,notes,last_used_at:data.last_used_at,archived_at:data.archived_at}}
export async function updateSubscriber(userId:string,id:string,input:Record<string,unknown>){const {w,db,data}=await ownedSubscriber(userId,id),display_name=clean(input.display_name,120,true),platform=clean(input.platform,80,true),platform_handle=clean(input.platform_handle,120)||null,notes=clean(input.notes,2000),v=creatorReplyDataKeyVersion();const {data:updated,error}=await db.from("sirens_mind_creator_reply_subscribers").update({display_name,platform,platform_handle,notes_ciphertext:notes?encryptCreatorReplyData(notes,subscriberNotesAad(w,id)):null,notes_key_version:notes?v:null,updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("id",data.id).select("id,display_name,platform,platform_handle,last_used_at,archived_at").maybeSingle();if(error||!updated)throw error||new Error("NOT_FOUND");return updated}
export async function setSubscriberArchived(userId:string,id:string,archived:boolean){const {w,db}=await ownedSubscriber(userId,id),now=new Date().toISOString();const {data,error}=await db.from("sirens_mind_creator_reply_subscribers").update({archived_at:archived?now:null,updated_at:now}).eq("workspace_id",w).eq("id",id).select("id,archived_at").maybeSingle();if(error||!data)throw error||new Error("NOT_FOUND");return data}
export async function deleteSubscriber(userId:string,id:string){const {w,db}=await ownedSubscriber(userId,id);const {data,error}=await db.from("sirens_mind_creator_reply_subscribers").delete().eq("workspace_id",w).eq("id",id).select("id").maybeSingle();if(error||!data)throw error||new Error("NOT_FOUND")}
async function ownedSubscriber(userId:string,id:string){const w=await resolveCreatorReplyWorkspace(userId),db=getSupabaseAdmin();const {data,error}=await db.from("sirens_mind_creator_reply_subscribers").select("*").eq("workspace_id",w).eq("id",id).maybeSingle();if(error)throw error;if(!data)throw new Error("NOT_FOUND");return {w,db,data}}
export async function conversations(userId:string,subscriberId:string){const {w,db}=await ownedSubscriber(userId,subscriberId);const {data,error}=await db.from("sirens_mind_creator_reply_conversations").select("id,status,last_used_at,updated_at,checkpoint_ciphertext").eq("workspace_id",w).eq("subscriber_id",subscriberId).order("updated_at",{ascending:false});if(error)throw error;return (data||[]).map(c=>{const p=parseCreatorReplyCheckpoint(JSON.parse(decryptCreatorReplyData(c.checkpoint_ciphertext,conversationCheckpointAad(w,c.id))));return{id:c.id,status:c.status,last_used_at:c.last_used_at,updated_at:c.updated_at,label:p?.label||"Conversation"}})}
export async function newConversation(userId:string,subscriberId:string){const {w,db}=await ownedSubscriber(userId,subscriberId),id=randomUUID(),v=creatorReplyDataKeyVersion();await db.from("sirens_mind_creator_reply_conversations").update({status:"paused",updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("subscriber_id",subscriberId).eq("status","active");const {error}=await db.from("sirens_mind_creator_reply_conversations").insert({id,workspace_id:w,subscriber_id:subscriberId,created_by_user_id:userId,status:"active",checkpoint_ciphertext:checkpoint(w,id,emptyCreatorReplyCheckpoint()),checkpoint_key_version:v});if(error)throw error;return{id,status:"active",label:""}}
export async function resumeConversation(userId:string,id:string){const w=await resolveCreatorReplyWorkspace(userId),db=getSupabaseAdmin();const {data}=await db.from("sirens_mind_creator_reply_conversations").select("subscriber_id,checkpoint_ciphertext,checkpoint_key_version").eq("workspace_id",w).eq("id",id).maybeSingle();if(!data)throw new Error("NOT_FOUND");assertCreatorReplyKeyVersion(data.checkpoint_key_version);await db.from("sirens_mind_creator_reply_conversations").update({status:"paused"}).eq("workspace_id",w).eq("subscriber_id",data.subscriber_id).eq("status","active");const {data:updated,error}=await db.from("sirens_mind_creator_reply_conversations").update({status:"active",archived_at:null,updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("id",id).select("id").maybeSingle();if(error||!updated)throw error||new Error("CONFLICT");const p=parseCreatorReplyCheckpoint(JSON.parse(decryptCreatorReplyData(data.checkpoint_ciphertext,conversationCheckpointAad(w,id))));return{id,subscriber_id:data.subscriber_id,status:"active",label:p?.label||"Conversation"}}
export async function resetConversation(userId:string,id:string){const w=await resolveCreatorReplyWorkspace(userId),db=getSupabaseAdmin(),v=creatorReplyDataKeyVersion();const {data}=await db.from("sirens_mind_creator_reply_conversations").select("checkpoint_revision").eq("workspace_id",w).eq("id",id).maybeSingle();if(!data)throw new Error("NOT_FOUND");const {data:updated,error}=await db.from("sirens_mind_creator_reply_conversations").update({thread_id:randomUUID(),checkpoint_ciphertext:checkpoint(w,id,emptyCreatorReplyCheckpoint()),checkpoint_key_version:v,checkpoint_revision:Number(data.checkpoint_revision)+1,updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("id",id).eq("checkpoint_revision",data.checkpoint_revision).select("id").maybeSingle();if(error||!updated)throw error||new Error("CONFLICT");return{id}}

export async function loadCreatorReplyAuthority(userId:string,subscriberId:string,conversationId:string){
 const {w,db,data:subscriber}=await ownedSubscriber(userId,subscriberId)
 const {data:conversation,error}=await db.from("sirens_mind_creator_reply_conversations").select("id,thread_id,checkpoint_ciphertext,checkpoint_key_version,checkpoint_revision,status").eq("workspace_id",w).eq("subscriber_id",subscriberId).eq("id",conversationId).maybeSingle()
 if(error)throw error;if(!conversation)throw new Error("NOT_FOUND")
 assertCreatorReplyKeyVersion(conversation.checkpoint_key_version)
 const parsed=parseCreatorReplyCheckpoint(JSON.parse(decryptCreatorReplyData(conversation.checkpoint_ciphertext,conversationCheckpointAad(w,conversationId))))
 if(!parsed)throw new Error("CHECKPOINT_INVALID")
 let notes="";if(subscriber.notes_ciphertext){assertCreatorReplyKeyVersion(subscriber.notes_key_version);notes=decryptCreatorReplyData(subscriber.notes_ciphertext,subscriberNotesAad(w,subscriberId))}
 return {workspaceId:w,subscriber:{id:subscriber.id,display_name:subscriber.display_name,platform:subscriber.platform,platform_handle:subscriber.platform_handle,key_notes:notes},conversation:{id:conversation.id,thread_id:conversation.thread_id,revision:Number(conversation.checkpoint_revision)},checkpoint:parsed}
}
export async function saveCreatorReplyCheckpoint(userId:string,authority:Awaited<ReturnType<typeof loadCreatorReplyAuthority>>,value:CreatorReplyCheckpoint){
 const w=await resolveCreatorReplyWorkspace(userId);if(w!==authority.workspaceId)throw new Error("NOT_FOUND");const db=getSupabaseAdmin(),now=new Date().toISOString(),v=creatorReplyDataKeyVersion()
 const {data,error}=await db.rpc("creator_reply_save_checkpoint",{p_workspace_id:w,p_subscriber_id:authority.subscriber.id,p_conversation_id:authority.conversation.id,p_expected_revision:authority.conversation.revision,p_ciphertext:checkpoint(w,authority.conversation.id,value),p_key_version:v})
 if(error)throw error;if(data!==true)throw new Error("CHECKPOINT_CONFLICT")
}
