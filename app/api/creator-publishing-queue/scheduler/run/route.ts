import { NextResponse } from "next/server"
import { isAuthorizedSchedulerRun, runDueScheduler } from "@/lib/creator-publishing-queue/autopost/scheduler"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export async function GET(req:Request){ if(!isAuthorizedSchedulerRun(req)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401}); try{return NextResponse.json(await runDueScheduler())}catch{return NextResponse.json({scanned:0,claimed:0,processed:0,blocked:0,skipped:0,failed:1},{status:500})}}
