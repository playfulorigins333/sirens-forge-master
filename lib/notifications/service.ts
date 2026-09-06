import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { buildNotification } from "./templates"
import type { ClaimedNotification, NotificationTransport } from "./types"
type Db={rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:{message:string}|null}>;auth:{admin:{getUserById(id:string):Promise<{data:{user:{id:string;email?:string}|null};error:unknown}>}}}
export type NotificationRun={materialized:number;claimed:number;delivered:number;retried:number;suppressed:number;uncertain:number}
const validEmail=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254
export const notificationsEnabled=(env:NodeJS.ProcessEnv=process.env)=>env.PHASE9_NOTIFICATIONS_ENABLED==="true"
export async function runNotifications(input:{db:Db;transport:NotificationTransport;limit?:number;log?:(event:Record<string,unknown>)=>void}):Promise<NotificationRun>{
 const limit=Math.min(Math.max(input.limit??25,1),50), out={materialized:0,claimed:0,delivered:0,retried:0,suppressed:0,uncertain:0};
 const m=await input.db.rpc("materialize_phase9_notifications",{p_limit:limit*4}); if(m.error)throw new Error("NOTIFICATION_MATERIALIZE_FAILED"); out.materialized=Number(m.data??0)
 const token=randomUUID(), claim=await input.db.rpc("claim_phase9_notifications",{p_lease_token:token,p_limit:limit}); if(claim.error)throw new Error("NOTIFICATION_CLAIM_FAILED"); const rows=(claim.data??[]) as ClaimedNotification[]; out.claimed=rows.length
 for(const row of rows){let outcome:"delivered"|"retry"|"suppressed"|"failed_uncertain"="suppressed",reason:string|null="ownership_mismatch",hash:string|null=null
  const identity=await input.db.auth.admin.getUserById(row.auth_user_id); const user=identity.data.user
  if(user?.id===row.auth_user_id && user.email && validEmail(user.email)){try{const result=await input.transport.send({to:user.email,mail:buildNotification(row.notification_kind,row.context),idempotencyKey:`phase9/${row.id}`}); if(result.kind==="delivered"){outcome="delivered";reason=null;hash=createHash("sha256").update(result.providerMessageId).digest("hex");out.delivered++}else if(result.kind==="retry"){outcome="retry";reason=null;out.retried++}else{outcome="failed_uncertain";reason="provider_outcome_uncertain";out.uncertain++}}catch{outcome="retry";reason=null;out.retried++}}else{reason=user?.email?"recipient_invalid":"recipient_missing";out.suppressed++}
  const final=await input.db.rpc("finalize_phase9_notification",{p_id:row.id,p_lease_token:token,p_outcome:outcome,p_reason:reason,p_provider_message_id_hash:hash}); if(final.error||final.data!==true)throw new Error("NOTIFICATION_FINALIZE_FAILED"); input.log?.({event:"phase9_notification_finalized",kind:row.notification_kind,outcome,attempt:row.attempts})
 } return out
}
