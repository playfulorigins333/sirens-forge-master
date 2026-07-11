import { NextResponse } from "next/server"
import { loadAutopostCapabilities } from "@/lib/creator-publishing-queue/autopost/service"
export async function GET(){ try{ return NextResponse.json({capabilities: await loadAutopostCapabilities()}) }catch{ return NextResponse.json({error:"AUTOPOST_CAPABILITIES_UNAVAILABLE"},{status:500}) } }
