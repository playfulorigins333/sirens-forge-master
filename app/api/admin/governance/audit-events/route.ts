import { NextResponse } from "next/server"
import { requireAdminCapability } from "@/lib/security/adminAuthorization"
import { listAuditEvents } from "@/lib/governance/auditEvents"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" }
const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers})
export async function GET(request: Request) {
  const auth=await requireAdminCapability("governance.audit.read"); if(auth.ok === false) return json({ok:false,code:auth.code,...(auth.actionPath?{actionPath:auth.actionPath}:{})},auth.status)
  const p=new URL(request.url).searchParams; if([...p.keys()].some(k=>!["before","limit","action","target_type","actor_type"].includes(k))) return json({ok:false,code:"AUDIT_PARAMETERS_INVALID"},400)
  const before=p.get("before")===null?null:Number(p.get("before")), limit=p.get("limit")===null?50:Number(p.get("limit"))
  const action=p.get("action"),targetType=p.get("target_type"),actorType=p.get("actor_type")
  if((before!==null&&(!Number.isSafeInteger(before)||before<1))||!Number.isInteger(limit)||limit<1||limit>100||
    (action!==null&&!/^[a-z0-9][a-z0-9_.:-]{2,119}$/.test(action))||(targetType!==null&&!/^[a-z0-9][a-z0-9_]{2,79}$/.test(targetType))||
    (actorType!==null&&!["creator","founder_admin","admin_operator","system","service"].includes(actorType))) return json({ok:false,code:"AUDIT_PARAMETERS_INVALID"},400)
  const result=await listAuditEvents({actorUserId:auth.userId,before,limit,action,targetType,actorType}); return result.ok?json(result):json({ok:false,code:"AUDIT_READ_UNAVAILABLE"},503)
}
