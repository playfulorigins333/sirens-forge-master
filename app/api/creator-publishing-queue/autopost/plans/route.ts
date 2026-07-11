import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { autopostSubscriptionGateStatus } from "@/lib/creator-publishing-queue/autopost/routeGate"
import { createAutopostPlan, httpStatusForAutopostError } from "@/lib/creator-publishing-queue/autopost/service"
export async function POST(req:Request){ const auth=await ensureActiveSubscription(); if(!auth.ok) return NextResponse.json({error:auth.error ?? "SUBSCRIPTION_REQUIRED"},{status:autopostSubscriptionGateStatus(auth.error, auth.status)}); const body=await req.json().catch(()=>({})); const result=await createAutopostPlan(body); if(result.ok === false) return NextResponse.json({error:result.code,message:result.message},{status:httpStatusForAutopostError(result.code)}); return NextResponse.json(result) }
