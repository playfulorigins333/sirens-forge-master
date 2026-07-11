import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { autopostSubscriptionGateStatus } from "@/lib/creator-publishing-queue/autopost/routeGate"
import { loadAutopostCapabilities } from "@/lib/creator-publishing-queue/autopost/service"
export async function GET(){ const auth=await ensureActiveSubscription(); if(!auth.ok) return NextResponse.json({error:auth.error ?? "SUBSCRIPTION_REQUIRED"},{status:autopostSubscriptionGateStatus(auth.error, auth.status)}); try{ return NextResponse.json({capabilities: await loadAutopostCapabilities()}) }catch(e:any){ if(e?.code === "UNAUTHENTICATED" || e?.message === "UNAUTHENTICATED") return NextResponse.json({error:"UNAUTHENTICATED"},{status:401}); return NextResponse.json({error:"AUTOPOST_CAPABILITIES_UNAVAILABLE"},{status:500}) } }
