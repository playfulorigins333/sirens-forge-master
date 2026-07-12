import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { autopostSubscriptionGateStatus } from "@/lib/creator-publishing-queue/autopost/routeGate"
import { cancelPublishingSchedule, httpStatusForSchedulerError } from "@/lib/creator-publishing-queue/autopost/scheduler"
export async function POST(req:Request){const auth=await ensureActiveSubscription(); if(!auth.ok)return NextResponse.json({error:auth.error??"SUBSCRIPTION_REQUIRED"},{status:autopostSubscriptionGateStatus(auth.error,auth.status)}); const result=await cancelPublishingSchedule(await req.json().catch(()=>({}))); if(result?.ok===false)return NextResponse.json({error:result.code,message:result.message},{status:httpStatusForSchedulerError(result.code)}); return NextResponse.json(result)}
