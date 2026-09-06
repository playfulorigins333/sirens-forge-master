import { NextResponse } from "next/server"
import { authenticateSchedulerRequest } from "@/lib/creator-publishing-queue/scheduler-runner/serviceCore"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { notificationsEnabled, runNotifications } from "@/lib/notifications/service"
import { createResendTransport } from "@/lib/notifications/resend"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  const auth = authenticateSchedulerRequest(request.headers, process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET)
  if (!auth.ok) {
    const code = "code" in auth ? auth.code : "UNAUTHORIZED"
    return NextResponse.json({ ok: false, error: code }, { status: code === "CRON_SECRET_NOT_CONFIGURED" ? 503 : 401, headers: { "Cache-Control": "no-store" } })
  }
  if (!notificationsEnabled()) return NextResponse.json({ ok: true, enabled: false }, { headers: { "Cache-Control": "no-store" } })
  try {
    const counts = await runNotifications({ db: getSupabaseAdmin() as any, transport: createResendTransport(), log: event => console.info(JSON.stringify(event)) })
    return NextResponse.json({ ok: true, enabled: true, ...counts }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const code = error instanceof Error && error.message === "NOTIFICATION_TRANSPORT_NOT_CONFIGURED" ? "NOTIFICATION_TRANSPORT_NOT_CONFIGURED" : "NOTIFICATION_RUN_FAILED"
    return NextResponse.json({ ok: false, error: code }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
