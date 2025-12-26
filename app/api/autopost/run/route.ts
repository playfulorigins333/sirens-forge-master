// app/api/autopost/run/route.ts

import { NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/* ──────────────────────────────────────────────
   Supabase (Service Role)
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

/* ──────────────────────────────────────────────
   Types — FLATTENED (NO UNION = NO LOOP)
────────────────────────────────────────────── */
type DispatchResult = {
  ok: boolean
  platform_post_id: string | null
  error_code: string | null
  error_message: string | null
}

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function nowISO() {
  return new Date().toISOString()
}

function assertCronAuth(req: Request) {
  const secret =
    process.env.CRON_SECRET ||
    process.env.VERCEL_CRON_SECRET ||
    ""

  if (!secret) return { ok: false, error: "CRON_SECRET_NOT_SET" }

  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return { ok: false, error: "UNAUTHORIZED" }
  }

  return { ok: true }
}

/* ──────────────────────────────────────────────
   Platform Dispatch (LAUNCH SAFE)
────────────────────────────────────────────── */
async function dispatchRule(): Promise<DispatchResult> {
  return {
    ok: false,
    platform_post_id: null,
    error_code: "PLATFORM_NOT_IMPLEMENTED",
    error_message: "Platform adapter not implemented yet",
  }
}

/* ──────────────────────────────────────────────
   Executor Core
────────────────────────────────────────────── */
async function runExecutor(req: Request, triggeredBy: string) {
  const auth = assertCronAuth(req)
  if (!auth.ok) return json(401, auth)

  const runId = `run_${crypto.randomBytes(6).toString("hex")}`
  const startedAt = nowISO()

  const { data: rules, error } = await supabase
    .from("autopost_rules")
    .select("*")

  if (error) {
    return json(500, { ok: false, error: error.message })
  }

  let scanned = 0
  let eligible = 0
  let dispatched = 0
  let succeeded = 0
  let failed = 0

  for (const rule of rules ?? []) {
    scanned++

    if (
      rule.approval_state !== "APPROVED" ||
      !rule.enabled ||
      rule.revoked_at ||
      rule.paused_at
    ) {
      continue
    }

    eligible++

    dispatched++
    const result = await dispatchRule()

    if (result.ok) succeeded++
    else failed++

    await supabase.from("autopost_run_results").insert({
      run_id: runId,
      rule_id: rule.id,
      user_id: rule.user_id,
      platform: "unknown",
      eligible: true,
      dispatched: true,
      success: result.ok,
      error_code: result.error_code,
      error_message: result.error_message,
      platform_post_id: result.platform_post_id,
    })
  }

  const finishedAt = nowISO()

  await supabase.from("autopost_runs").insert({
    run_id: runId,
    triggered_by: triggeredBy,
    started_at: startedAt,
    finished_at: finishedAt,
    scanned,
    eligible,
    dispatched,
    succeeded,
    failed,
    dry_run: false,
  })

  return json(200, {
    ok: true,
    runId,
    startedAt,
    finishedAt,
    summary: { scanned, eligible, dispatched, succeeded, failed },
  })
}

/* ──────────────────────────────────────────────
   GET = CRON EXECUTOR
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const url = new URL(req.url)

  if (url.searchParams.get("health") === "1") {
    const auth = assertCronAuth(req)
    if (!auth.ok) return json(401, auth)

    return json(200, {
      ok: true,
      route: "/api/autopost/run",
      exec: "GET",
      status: "alive",
    })
  }

  return runExecutor(req, "vercel-cron")
}

/* ──────────────────────────────────────────────
   POST = MANUAL TRIGGER
────────────────────────────────────────────── */
export async function POST(req: Request) {
  return runExecutor(req, "manual")
}
