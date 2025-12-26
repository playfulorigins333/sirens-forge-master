// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   ENV
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.VERCEL_CRON_SECRET || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/* ──────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────── */
function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function nowISO() {
  return new Date().toISOString();
}

/* ──────────────────────────────────────────────
   CRON AUTH (ACCEPT BOTH METHODS)
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  if (!CRON_SECRET) {
    return { ok: false, error: "CRON_SECRET_NOT_SET" };
  }

  // 1️⃣ Manual / curl testing
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${CRON_SECRET}`) {
    return { ok: true };
  }

  // 2️⃣ Vercel Cron (THIS IS WHAT WAS FAILING)
  const vercelSecret = req.headers.get("x-vercel-cron-secret");
  if (vercelSecret === CRON_SECRET) {
    return { ok: true };
  }

  return { ok: false, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   EXECUTOR
────────────────────────────────────────────── */
async function runExecutor(req: Request, trigger: "manual" | "vercel-cron") {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const runId = `run_${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = nowISO();

  // Fetch approved rules only
  const { data: rules, error } = await supabase
    .from("autopost_rules")
    .select("*")
    .eq("approval_state", "APPROVED");

  if (error) {
    return json(500, { ok: false, runId, error: error.message });
  }

  const scanned = rules?.length ?? 0;

  // Persist run summary
  await supabase.from("autopost_runs").insert({
    run_id: runId,
    triggered_by: trigger,
    started_at: startedAt,
    finished_at: nowISO(),
    scanned,
    eligible: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
    dry_run: false,
  });

  return json(200, {
    ok: true,
    runId,
    startedAt,
    finishedAt: nowISO(),
    summary: {
      scanned,
      eligible: 0,
      dispatched: 0,
      succeeded: 0,
      failed: 0,
    },
  });
}

/* ──────────────────────────────────────────────
   GET — HEALTH / CRON
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    const auth = assertCronAuth(req);
    if (!auth.ok) return json(401, auth);

    return json(200, {
      ok: true,
      route: "/api/autopost/run",
      status: "alive",
    });
  }

  return runExecutor(req, "vercel-cron");
}

/* ──────────────────────────────────────────────
   POST — MANUAL TRIGGER
────────────────────────────────────────────── */
export async function POST(req: Request) {
  return runExecutor(req, "manual");
}
