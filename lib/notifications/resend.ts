import "server-only"
import { Resend } from "resend"
import type { NotificationTransport } from "./types"
export function createResendTransport(env:NodeJS.ProcessEnv=process.env):NotificationTransport {
 const key=env.RESEND_API_KEY, from=env.PHASE9_NOTIFICATION_FROM_EMAIL
 if(!key || !from) throw new Error("NOTIFICATION_TRANSPORT_NOT_CONFIGURED")
 const resend=new Resend(key)
 return {async send({to,mail,idempotencyKey}){try{const result=await resend.emails.send({from,to,subject:mail.subject,text:mail.text,html:mail.html},{idempotencyKey}); if(result.error){const status=(result.error as {statusCode?:number}).statusCode; return status && status>=400 && status<500?{kind:"uncertain",code:"PROVIDER_PERMANENT"}:{kind:"retry",code:"PROVIDER_RETRYABLE"}} if(!result.data?.id)return {kind:"uncertain",code:"PROVIDER_OUTCOME_UNCERTAIN"}; return {kind:"delivered",providerMessageId:result.data.id}}catch{return {kind:"uncertain",code:"PROVIDER_OUTCOME_UNCERTAIN"}}}}
}
