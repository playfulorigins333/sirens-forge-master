import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createXControlledRefreshAccountLoader,createXControlledRefreshWriter,handleXControlledRefreshRequest,xControlledRefreshMethodNotAllowedResult } from "@/lib/autopost/xControlledRefresh"
export const runtime="nodejs",dynamic="force-dynamic",revalidate=0
const headers={"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}
export async function POST(request:Request){const r=await handleXControlledRefreshRequest({request,getAuthenticatedUserId:()=>requireUserId({request}),createPrivilegedAccess:()=>{const c=getSupabaseAdmin();return{load:createXControlledRefreshAccountLoader(c),writer:createXControlledRefreshWriter(c)}}});return NextResponse.json(r.body,{status:r.status,headers})}
export function GET(){return NextResponse.json(xControlledRefreshMethodNotAllowedResult(),{status:405,headers})}
