import { NextResponse } from "next/server"
import { runCreatorPublishingScheduler } from "@/lib/creator-publishing-queue/scheduler-runner/service"
import { authenticateSchedulerRequest } from "@/lib/creator-publishing-queue/scheduler-runner/serviceCore"
import { fanvueWorkerEnabled, runProductionFanvueCpqWorker } from "@/lib/creator-publishing-queue/fanvue/workerRuntime"

export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=60

function statusFor(code:string){
  if(code==="UNAUTHORIZED") return 401
  if(code==="CRON_SECRET_NOT_CONFIGURED") return 503
  if(code.endsWith("_DISABLED")) return 503
  return 500
}

export async function GET(req:Request){
  const secret=process.env.CRON_SECRET||process.env.VERCEL_CRON_SECRET
  const auth=authenticateSchedulerRequest(req.headers,secret)
  if(auth.ok===false) return NextResponse.json({ok:false,code:auth.code},{status:statusFor(auth.code)})
  if(process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED!=="true") return NextResponse.json({ok:false,code:"FANVUE_PUBLIC_ACTIVATION_DISABLED"},{status:503})
  if(!fanvueWorkerEnabled()) return NextResponse.json({ok:false,code:"FANVUE_CPQ_WORKER_DISABLED"},{status:503})

  const scheduler=await runCreatorPublishingScheduler(req.headers)
  if(scheduler.ok===false) return NextResponse.json({ok:false,code:scheduler.code},{status:statusFor(scheduler.code)})

  try{
    const worker=await runProductionFanvueCpqWorker()
    return NextResponse.json({
      ok:true,
      code:"FANVUE_CPQ_RUN_COMPLETED",
      scheduler:{claimed:scheduler.claimedCount,processed:scheduler.processedCount,blocked:scheduler.blockedCount,superseded:scheduler.supersededCount},
      worker,
    },{status:200})
  }catch{
    return NextResponse.json({ok:false,code:"FANVUE_CPQ_WORKER_FAILED"},{status:500})
  }
}
