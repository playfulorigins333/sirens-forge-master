import "server-only"
import { randomUUID } from "node:crypto"
import { getSupabaseAdmin } from "../supabaseAdmin"
import { conversationCheckpointAad, creatorReplyDataKeyVersion, decryptCreatorReplyData, encryptCreatorReplyData, subscriberNotesAad } from "./creator-reply-crypto"
import { CreatorReplyCheckpoint, emptyCreatorReplyCheckpoint, parseCreatorReplyCheckpoint } from "./creator-reply-checkpoint"

const clean = (v: unknown, max: number, required=false) => { const s=typeof v==="string"?v.trim():""; if ((required&&!s)||s.length>max) throw new Error("INVALID_INPUT"); return s }
async function workspace(userId:string) {
  const db=getSupabaseAdmin()
  const {data:member,error}=await db.from("sirens_mind_creator_reply_workspace_members").select("workspace_id").eq("user_id",userId).order("created_at").limit(1).maybeSingle()
  if(error) throw error; if(member) return member.workspace_id as string
  const id=randomUUID(), now=new Date().toISOString()
  const {error:createError}=await db.from("sirens_mind_creator_reply_workspaces").insert({id,created_by_user_id:userId,display_name:"Creator Reply",created_at:now,updated_at:now})
  if(createError) throw createError
  const {error:memberError}=await db.from("sirens_mind_creator_reply_workspace_members").insert({workspace_id:id,user_id:userId,role:"owner"})
  if(memberError) { await db.from("sirens_mind_creator_reply_workspaces").delete().eq("id",id).eq("created_by_user_id",userId); throw memberError }
  return id
}
const checkpoint = (w:string,c:string,value:CreatorReplyCheckpoint) => encryptCreatorReplyData(JSON.stringify(value),conversationCheckpointAad(w,c))
export async function listSubscribers(userId:string, archived=false) {
  const w=await workspace(userId), db=getSupabaseAdmin()
  let q=db.from("sirens_mind_creator_reply_subscribers").select("id,display_name,platform,platform_handle,last_used_at,archived_at,updated_at").eq("workspace_id",w).order("last_used_at",{ascending:false,nullsFirst:false}).order("updated_at",{ascending:false})
  q=archived?q.not("archived_at","is",null):q.is("archived_at",null); const {data,error}=await q; if(error)throw error; return data
}
export async function createSubscriber(userId:string,input:Record<string,unknown>) {
  const w=await workspace(userId), db=getSupabaseAdmin(), sid=randomUUID(), cid=randomUUID(), keyVersion=creatorReplyDataKeyVersion()
  const display_name=clean(input.display_name,120,true), platform=clean(input.platform,80,true), platform_handle=clean(input.platform_handle,120)||null, notes=clean(input.notes,2000)
  const notes_ciphertext=notes?encryptCreatorReplyData(notes,subscriberNotesAad(w,sid)):null
  const checkpoint_ciphertext=checkpoint(w,cid,emptyCreatorReplyCheckpoint())
  const {error:sError}=await db.from("sirens_mind_creator_reply_subscribers").insert({id:sid,workspace_id:w,created_by_user_id:userId,display_name,platform,platform_handle,notes_ciphertext,notes_key_version:notes?keyVersion:null})
  if(sError)throw sError
  const {error:cError}=await db.from("sirens_mind_creator_reply_conversations").insert({id:cid,workspace_id:w,subscriber_id:sid,created_by_user_id:userId,status:"active",checkpoint_ciphertext,checkpoint_key_version:keyVersion})
  if(cError){await db.from("sirens_mind_creator_reply_subscribers").delete().eq("workspace_id",w).eq("id",sid);throw cError}
  return {subscriber:{id:sid,display_name,platform,platform_handle},conversation:{id:cid,status:"active",label:""}}
}
async function ownedSubscriber(userId:string,id:string){const w=await workspace(userId),db=getSupabaseAdmin();const {data,error}=await db.from("sirens_mind_creator_reply_subscribers").select("*").eq("workspace_id",w).eq("id",id).maybeSingle();if(error)throw error;if(!data)throw new Error("NOT_FOUND");return {w,db,data}}
export async function conversations(userId:string,subscriberId:string){const {w,db}=await ownedSubscriber(userId,subscriberId);const {data,error}=await db.from("sirens_mind_creator_reply_conversations").select("id,status,last_used_at,updated_at,checkpoint_ciphertext").eq("workspace_id",w).eq("subscriber_id",subscriberId).order("updated_at",{ascending:false});if(error)throw error;return (data||[]).map(c=>{const p=parseCreatorReplyCheckpoint(JSON.parse(decryptCreatorReplyData(c.checkpoint_ciphertext,conversationCheckpointAad(w,c.id))));return{id:c.id,status:c.status,last_used_at:c.last_used_at,updated_at:c.updated_at,label:p?.label||"Conversation"}})}
export async function newConversation(userId:string,subscriberId:string){const {w,db}=await ownedSubscriber(userId,subscriberId),id=randomUUID(),v=creatorReplyDataKeyVersion();await db.from("sirens_mind_creator_reply_conversations").update({status:"paused",updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("subscriber_id",subscriberId).eq("status","active");const {error}=await db.from("sirens_mind_creator_reply_conversations").insert({id,workspace_id:w,subscriber_id:subscriberId,created_by_user_id:userId,status:"active",checkpoint_ciphertext:checkpoint(w,id,emptyCreatorReplyCheckpoint()),checkpoint_key_version:v});if(error)throw error;return{id,status:"active",label:""}}
export async function resumeConversation(userId:string,id:string){const w=await workspace(userId),db=getSupabaseAdmin();const {data}=await db.from("sirens_mind_creator_reply_conversations").select("subscriber_id,checkpoint_ciphertext").eq("workspace_id",w).eq("id",id).maybeSingle();if(!data)throw new Error("NOT_FOUND");await db.from("sirens_mind_creator_reply_conversations").update({status:"paused"}).eq("workspace_id",w).eq("subscriber_id",data.subscriber_id).eq("status","active");const {error}=await db.from("sirens_mind_creator_reply_conversations").update({status:"active",archived_at:null,updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("id",id);if(error)throw error;const p=parseCreatorReplyCheckpoint(JSON.parse(decryptCreatorReplyData(data.checkpoint_ciphertext,conversationCheckpointAad(w,id))));return{id,subscriber_id:data.subscriber_id,status:"active",label:p?.label||"Conversation"}}
export async function resetConversation(userId:string,id:string){const w=await workspace(userId),db=getSupabaseAdmin(),v=creatorReplyDataKeyVersion();const {data}=await db.from("sirens_mind_creator_reply_conversations").select("checkpoint_revision").eq("workspace_id",w).eq("id",id).maybeSingle();if(!data)throw new Error("NOT_FOUND");const {error}=await db.from("sirens_mind_creator_reply_conversations").update({thread_id:randomUUID(),checkpoint_ciphertext:checkpoint(w,id,emptyCreatorReplyCheckpoint()),checkpoint_key_version:v,checkpoint_revision:Number(data.checkpoint_revision)+1,updated_at:new Date().toISOString()}).eq("workspace_id",w).eq("id",id).eq("checkpoint_revision",data.checkpoint_revision);if(error)throw error;return{id}}
