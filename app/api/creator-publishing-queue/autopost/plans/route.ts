import { NextResponse } from "next/server"
import { createAutopostPlan, httpStatusForAutopostError } from "@/lib/creator-publishing-queue/autopost/service"
export async function POST(req:Request){ const body=await req.json().catch(()=>({})); const result=await createAutopostPlan(body); if(result.ok === false) return NextResponse.json({error:result.code,message:result.message},{status:httpStatusForAutopostError(result.code)}); return NextResponse.json(result) }
