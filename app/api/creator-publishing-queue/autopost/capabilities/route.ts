import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { loadAutopostCapabilities } from "@/lib/creator-publishing-queue/autopost/service"
function gateStatus(error?: string, status?: number){ if(error === "UNAUTHENTICATED") return 401; if(error === "NO_ACTIVE_SUBSCRIPTION" || error === "NO_PROFILE") return status ?? 402; return 500 }
export async function GET(){ const auth=await ensureActiveSubscription(); if(!auth.ok) return NextResponse.json({error:auth.error ?? "SUBSCRIPTION_REQUIRED"},{status:gateStatus(auth.error, auth.status)}); try{ return NextResponse.json({capabilities: await loadAutopostCapabilities()}) }catch(e:any){ if(e?.code === "UNAUTHENTICATED" || e?.message === "UNAUTHENTICATED") return NextResponse.json({error:"UNAUTHENTICATED"},{status:401}); return NextResponse.json({error:"AUTOPOST_CAPABILITIES_UNAVAILABLE"},{status:500}) } }
