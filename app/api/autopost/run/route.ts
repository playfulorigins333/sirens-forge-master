// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   Supabase Admin (Service Role)
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
  details?: any;
};

type DispatchFailure = {
  ok: false;
  error: string;
  details?: any;
};

type DispatchResult = DispatchSuccess | DispatchFailure;

/**
 * ✅ HARD STOP FOR TS2339
 * This guard makes narrowing 100% reliable everywhere.
 */
function isDispatchFailure(res: DispatchResult): res is DispatchFailure {
  return res.ok === false;
}

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

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n =
    typeof v === "string"
      ? Number.parseInt(v, 10)
      : typeof v === "number"
      ? v
      : NaN;

  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ──────────────────────────────────────────────
   Vercel Cron Auth (Authorization: Bearer ...)
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  const expected = process.env.VERCEL_CRON_SECRET;
  if (!expected) return { ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" };

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) return { ok: false as const, error: "UNAUTHORIZED" };

  return { ok: true as const };
}

/* ──────────────────────────────────────────────
   Schedule Eligibility
────────────────────────────────────────────── */
function isEligibleToRun(rule: AutopostRule, now: Date) {
  const nra = parseDate(rule.next_run_at);
  if (nra) return nra.getTime() <= now.getTime();

  const cadence = typeof rule.cadence_minutes === "number" ? rule.cadence_minutes : null;
  if (cadence && cadence > 0) {
    const last = parseDate(rule.last_run_at);
    if (!last) return true;
    const next = last.getTime() + cadence * 60_000;
    return next <= now.getTime();
  }

  // Safe default: skip if schedule is unknown
  return false;
}

function computeNextRunAt(rule: AutopostRule, now: Date): string | null {
  const cadence = typeof rule.cadence_minutes === "number" ? rule.cadence_minutes : null;
  if (cadence && cadence > 0) return new Date(now.getTime() + cadence * 60_000).toISOString();
  return null;
}

/* ──────────────────────────────────────────────
   Dispatch (MOCKED but strict success/fail)
   IMPORTANT: returns MUST preserve literal ok true/false
────────────────────────────────────────────── */
async function dispatchToPlatform(rule: AutopostRule): Promise<DispatchResult> {
  const payload = rule.payload ?? {};
  const caption = typeof payload.caption === "string" ? payload.caption : "";
  const media = payload.media ?? rule.media ?? null;

  // Return literal union members (no inference drift)
  const fail = (error: string, details?: any): DispatchFailure => ({ ok: false, error, details });
  const ok = (platform_post_id: string, details?: any): DispatchSuccess => ({ ok: true, platform_post_id, details });

  if (!caption && !media) return fail("EMPTY_POST", { hint: "caption or media required" });
  if (String(rule.content_mode) === "video" && !media) return fail("MISSING_MEDIA_FOR_VIDEO");

  const id = crypto
    .createHash("sha256")
    .update(`${rule.id}:${caption}`)
    .digest("hex")
    .slice(0, 12);

  return ok(`mock_${String(rule.platform).toLowerCase()}_${id}`, { mocked: true });
}

/* ──────────────────────────────────────────────
   POST — Executor
────────────────────────────────────────────── */
export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "SUPABASE_NOT_CONFIGURED" });
  }

  const runId = crypto.randomUUID();
  const now = new Date();

  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);
  const dryRun = req.headers.get("x-autopost-dry-run") === "1";

  const { data: rules, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .eq("status", "APPROVED")
    .limit(maxRules);

  if (error) {
    return json(500, { ok: false, error: "RULE_QUERY_FAILED", details: error.message, runId });
  }

  const allRules = (rules ?? []) as AutopostRule[];

  let scanned = allRules.length;
  let eligible = 0;
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;

  const results: Array<{
    rule_id: string;
    user_id: string;
    platform: string;
    eligible: boolean;
    dispatched: boolean;
    ok?: boolean;
    error?: string;
    platform_post_id?: string;
  }> = [];

  for (const rule of allRules) {
    if (String(rule.status) !== "APPROVED") continue;

    const canRun = isEligibleToRun(rule, now);
    if (!canRun) {
      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: String(rule.platform),
        eligible: false,
        dispatched: false,
      });
      continue;
    }

    eligible++;

    if (dryRun) {
      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: String(rule.platform),
        eligible: true,
        dispatched: false,
        ok: true,
        platform_post_id: "dry_run",
      });
      continue;
    }

    dispatched++;

    const res = await dispatchToPlatform(rule);

    if (!isDispatchFailure(res)) {
      // ✅ success branch
      succeeded++;

      const nextRunAt = computeNextRunAt(rule, now);
      const updatePayload: Record<string, any> = { last_run_at: now.toISOString() };
      if (nextRunAt) updatePayload.next_run_at = nextRunAt;

      await supabaseAdmin.from("autopost_rules").update(updatePayload).eq("id", rule.id);

      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: String(rule.platform),
        eligible: true,
        dispatched: true,
        ok: true,
        platform_post_id: res.platform_post_id,
      });
    } else {
      // ✅ failure branch (narrowed by guard)
      failed++;

      const errorMessage = res.error;

      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: String(rule.platform),
        eligible: true,
        dispatched: true,
        ok: false,
        error: errorMessage,
      });
    }
  }

  return json(200, {
    ok: true,
    runId,
    startedAt: nowISO(),
    finishedAt: nowISO(),
    dryRun,
    maxRules,
    summary: { scanned, eligible, dispatched, succeeded, failed },
    results,
  });
}

/* ──────────────────────────────────────────────
   GET — Health Check
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  return json(200, {
    ok: true,
    route: "/api/autopost/run",
    trigger: "vercel-cron",
  });
}
