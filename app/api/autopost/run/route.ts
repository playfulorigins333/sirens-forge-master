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
  platform: string;
  content_mode: "image" | "video" | string;
  status: "DRAFT" | "APPROVED" | "PAUSED" | "REVOKED" | string;

  cadence_minutes?: number | null;
  next_run_at?: string | null;
  last_run_at?: string | null;

  payload?: any;
  media?: any;
};

type DispatchSuccess = {
  ok: true;
  platform_post_id: string;
};

type DispatchFailure = {
  ok: false;
  error: string;
};

type DispatchResult = DispatchSuccess | DispatchFailure;

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
   Schedule
────────────────────────────────────────────── */
function isEligibleToRun(rule: AutopostRule, now: Date) {
  const nra = parseDate(rule.next_run_at);
  if (nra) return nra <= now;

  const cadence =
    typeof rule.cadence_minutes === "number"
      ? rule.cadence_minutes
      : null;

  if (!cadence) return false;

  const last = parseDate(rule.last_run_at);
  if (!last) return true;

  return last.getTime() + cadence * 60000 <= now.getTime();
}

function computeNextRunAt(rule: AutopostRule, now: Date) {
  if (!rule.cadence_minutes) return null;
  return new Date(
    now.getTime() + rule.cadence_minutes * 60000
  ).toISOString();
}

/* ──────────────────────────────────────────────
   Dispatch (mocked)
────────────────────────────────────────────── */
async function dispatchToPlatform(
  rule: AutopostRule
): Promise<DispatchResult> {
  const caption =
    rule.payload?.caption ??
    "";

  const media = rule.media ?? null;

  if (!caption && !media) {
    return { ok: false, error: "EMPTY_POST" };
  }

  const id = crypto
    .createHash("sha256")
    .update(`${rule.id}:${caption}`)
    .digest("hex")
    .slice(0, 12);

  return {
    ok: true,
    platform_post_id: `mock_${rule.platform}_${id}`,
  };
}

/* ──────────────────────────────────────────────
   EXECUTOR (shared)
────────────────────────────────────────────── */
async function runExecutor() {
  const now = new Date();

  const { data: rules, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .eq("status", "APPROVED");

  if (error) {
    return { ok: false, error: error.message };
  }

  let scanned = rules.length;
  let eligible = 0;
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;

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
          next_run_at: computeNextRunAt(rule, now),
        })
        .eq("id", rule.id);
    } else {
      failed++;
    }
  }

  return {
    ok: true,
    summary: { scanned, eligible, dispatched, succeeded, failed },
  };
}

/* ──────────────────────────────────────────────
   GET — Vercel Cron (NO AUTH)
────────────────────────────────────────────── */
export async function GET() {
  const result = await runExecutor();
  return json(200, result);
}

/* ──────────────────────────────────────────────
   POST — Manual / internal (AUTH REQUIRED)
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
