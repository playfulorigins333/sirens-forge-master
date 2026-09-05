import { NextResponse } from "next/server";
import { authenticateSchedulerRequest } from "@/lib/creator-publishing-queue/scheduler-runner/serviceCore";
import { runPhase8dCanceledAccountEnforcement } from "@/lib/retention/phase8d";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
  const auth = authenticateSchedulerRequest(request.headers, configuredSecret);
  if (auth.ok === false) {
    const status = auth.code === "CRON_SECRET_NOT_CONFIGURED" ? 503 : 401;
    return NextResponse.json(auth, { status, headers: noStore });
  }

  const result = await runPhase8dCanceledAccountEnforcement();
  console.info({ event: "phase8d_canceled_account_enforcement_run", ...result });
  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers: noStore });
}
