import "server-only"
export const notificationKinds = ["export_ready","deletion_requested","deletion_reactivated","deletion_completed","cancellation_day_0","cancellation_day_30","cancellation_day_45","cancellation_day_55","delinquency_day_0","delinquency_day_30","delinquency_day_45","delinquency_day_55"] as const
export type NotificationKind = typeof notificationKinds[number]
export type ClaimedNotification = { id:string; source_type:string; source_id:string; notification_kind:NotificationKind; auth_user_id:string; due_at:string; attempts:number; context:Record<string,string|null> }
export type Mail = { subject:string; text:string; html:string }
export interface NotificationTransport { send(input:{to:string; mail:Mail; idempotencyKey:string}):Promise<{kind:"delivered";providerMessageId:string}|{kind:"retry";code:string}|{kind:"uncertain";code:string}> }
