import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { createAutopostPlan, httpStatusForAutopostError } from "@/lib/creator-publishing-queue/autopost/service"
function gateStatus(error?: string, status?: number){ if(error === "UNAUTHENTICATED") return 401; if(error === "NO_ACTIVE_SUBSCRIPTION" || error === "NO_PROFILE") return status ?? 402; return 500 }
export async function POST(req:Request){ const auth=await ensureActiveSubscription(); if(!auth.ok) return NextResponse.json({error:auth.error ?? "SUBSCRIPTION_REQUIRED"},{status:gateStatus(auth.error, auth.status)}); const body=await req.json().catch(()=>({})); const result=await createAutopostPlan(body); if(result.ok === false) return NextResponse.json({error:result.code,message:result.message},{status:httpStatusForAutopostError(result.code)}); return NextResponse.json(result) }
