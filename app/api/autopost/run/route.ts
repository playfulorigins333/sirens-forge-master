// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   Supabase Admin
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY
);

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */
type AutopostRule = {
  id: string;
  user_id: string;
  approval_state: "DRAFT" | "APPROVED" | "PAUSED" | "REVOKED" | string;

  enabled: boolean;

  next_run_at?: string | null;
  last_run_at?: string | null;

  payload?: any;
};

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function nowISO() {
  return new Date().toISOString();
}

function parseDate(v?: string | null) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

/* ──────────────────────────────────────────────
   Schedule Eligibility
────────────────────────────────────────────── */
function isEligibleToRun(rule: AutopostRule, now: Date) {
  if (!rule.enabled) return false;

  const nra = parseDate(rule.next_run_at);
  if (nra) return nra.getTime() <= now.getTime();

  return false;
}

/* ──────────────────────────────────────────────
   Dispatch (mocked)
────────────────────────────────────────────── */
async function dispatchToPlatform(rule: AutopostRule) {
  const id = crypto
    .createHash("sha256")
    .update(rule.id)
    .digest("hex")
    .slice(0, 12);

  return {
    ok: true,
    platform_post_id: `mock_post_${id}`,
  };
}

/* ──────────────────────────────────────────────
   Executor
────────────────────────────────────────────── */
async function runExecutor() {
  const now = new Date();

  const { data: rules, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .eq("approval_state", "APPROVED");

  if (error) {
    return { ok: false, error: error.message };
  }

  let scanned = rules.length;
  let eligible = 0;
  let dispatched = 0;
  let succeeded = 0;

  for (const rule of rules as AutopostRule[]) {
    if (!isEligibleToRun(rule, now)) continue;
    eligible++;

    dispatched++;
    const res = await dispatchToPlatform(rule);

    if (res.ok) {
      succeeded++;

      await supabaseAdmin
        .from("autopost_rules")
        .update({
          last_run_at: nowISO(),
        })
        .eq("id", rule.id);
    }
  }

  return {
    ok: true,
    summary: { scanned, eligible, dispatched, succeeded },
  };
}

/* ──────────────────────────────────────────────
   GET — Vercel Cron
────────────────────────────────────────────── */
export async function GET() {
  const result = await runExecutor();
  return json(200, result);
}

/* ──────────────────────────────────────────────
   POST — Manual (Auth)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  const secret = process.env.VERCEL_CRON_SECRET;
  const auth = req.headers.get("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const result = await runExecutor();
  return json(200, result);
}
