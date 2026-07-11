import { NextResponse } from "next/server"
import { createAutopostPlan } from "@/lib/creator-publishing-queue/autopost/service"
export async function POST(req:Request){
  const body=await req.json().catch(()=>({}))
  const result=await createAutopostPlan(body)
  if(result.ok === false){
    const status = result.code==="UNAUTHENTICATED" ? 401 : result.code==="IDEMPOTENCY_CONFLICT" ? 409 : 400
    return NextResponse.json({error:result.code,message:result.message},{status})
  }
  return NextResponse.json(result)
}
