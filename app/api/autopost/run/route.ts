// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   Supabase (Service Role)
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/* ──────────────────────────────────────────────
   Types (NO UNION TYPES)
────────────────────────────────────────────── */
type AutopostRule = {
  id: string;
  user_id: string;

  enabled: boolean;
  approval_state: string;

  paused_at: string | null;
  revoked_at: string | null;

  next_run_at: string | null;
  last_run_at: string | null;

  selected_platforms: any;
  payload: any;
};

type DispatchEnvelope = {
  attempted: boolean;
  success: boolean | null;
  platform_post_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: any) {
  return NextResponse.json(body, { status });
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
   CRON AUTH — FIXED FOR VERCEL
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  const expected = process.env.VERCEL_CRON_SECRET;
  if (!expected) return { ok: false as const, error: "CRON_SECRET_NOT_SET" };

  // ✅ Vercel cron header
  const cronSecret = req.headers.get("x-vercel-cron-secret");
  if (cronSecret === expected) {
    return { ok: true as const };
  }

  // Optional manual trigger support
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) {
    return { ok: true as const };
  }

  return { ok: false as const, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   Lifecycle Enforcement (LOCKED)
────────────────────────────────────────────── */
function lifecycleBlocksRun(rule: AutopostRule): { blocked: boolean; reason?: string } {
  if (rule.approval_state === "REVOKED") return { blocked: true, reason: "REVOKED_STATE" };
  if (rule.revoked_at) return { blocked: true, reason: "REVOKED_AT_SET" };

  if (rule.approval_state === "PAUSED") return { blocked: true, reason: "PAUSED_STATE" };
  if (rule.paused_at) return { blocked: true, reason: "PAUSED_AT_SET" };

  if (rule.approval_state !== "APPROVED") return { blocked: true, reason: "NOT_APPROVED" };
  if (!rule.enabled) return { blocked: true, reason: "DISABLED" };

  return { blocked: false };
}

function isEligibleByTime(rule: AutopostRule, now: Date): boolean {
  const next = parseDate(rule.next_run_at);
  if (!next) return false;
  return next.getTime() <= now.getTime();
}

function normalizePlatforms(selected_platforms: any): string[] {
  if (Array.isArray(selected_platforms)) {
    return selected_platforms.filter((p) => typeof p === "string");
  }
  return [];
}

/* ──────────────────────────────────────────────
   Platform Dispatch (Launch-safe)
────────────────────────────────────────────── */
async function dispatchToPlatform(
  platform: string,
  rule: AutopostRule
): Promise<DispatchEnvelope> {
  if (platform.startsWith("webhook:")) {
    const url = platform.slice("webhook:".length).trim();
    if (!url) {
      return {
        attempted: true,
        success: false,
        platform_post_id: null,
        error_code: "WEBHOOK_URL_MISSING",
        error_message: "No webhook URL provided",
      };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_id: rule.id,
          user_id: rule.user_id,
          payload: rule.payload ?? {},
        }),
      });

      if (!res.ok) {
        return {
          attempted: true,
          success: false,
          platform_post_id: null,
          error_code: "WEBHOOK_HTTP_ERROR",
          error_message: `HTTP ${res.status}`,
        };
      }

      return {
        attempted: true,
        success: true,
        platform_post_id: crypto.randomUUID(),
        error_code: null,
        error_message: null,
      };
    } catch (e: any) {
      return {
        attempted: true,
        success: false,
        platform_post_id: null,
        error_code: "WEBHOOK_EXCEPTION",
        error_message: String(e?.message || e),
      };
    }
  }

  return {
    attempted: true,
    success: false,
    platform_post_id: null,
    error_code: "PLATFORM_NOT_SUPPORTED",
    error_message: platform,
  };
}

/* ──────────────────────────────────────────────
   Safe DB Helpers (NEVER fatal)
────────────────────────────────────────────── */
async function safeInsert(table: string, row: any) {
  try {
    await supabaseAdmin.from(table).insert(row);
  } catch {}
}

async function safeUpdate(table: string, patch: any, where: any) {
  try {
    await supabaseAdmin.from(table).update(patch).match(where);
  } catch {}
}

/* ──────────────────────────────────────────────
   POST — EXECUTOR
────────────────────────────────────────────── */
export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const runId = `run_${crypto.randomUUID()}`;
  const now = new Date();
  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);
  const dryRun = req.headers.get("x-autopost-dry-run") === "1";

  const { data: rules } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .limit(maxRules);

  const allRules = (rules ?? []) as AutopostRule[];

  let scanned = allRules.length;
  let eligible = 0;
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;

  await safeInsert("autopost_runs", {
    run_id: runId,
    triggered_by: "vercel-cron",
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    scanned,
    eligible: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
    dry_run: dryRun,
  });

  for (const rule of allRules) {
    const block = lifecycleBlocksRun(rule);
    if (block.blocked || !isEligibleByTime(rule, now)) {
      continue;
    }

    eligible++;
    const platforms = normalizePlatforms(rule.selected_platforms);

    for (const platform of platforms) {
      dispatched++;

      if (dryRun) continue;

      const res = await dispatchToPlatform(platform, rule);

      if (res.success) succeeded++;
      else failed++;

      await safeInsert("autopost_run_results", {
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform,
        eligible: true,
        dispatched: res.attempted,
        success: res.success,
        error_code: res.error_code,
        error_message: res.error_message,
        platform_post_id: res.platform_post_id,
      });
    }

    if (!dryRun) {
      await safeUpdate(
        "autopost_rules",
        { last_run_at: now.toISOString() },
        { id: rule.id }
      );
    }
  }

  await safeUpdate(
    "autopost_runs",
    {
      eligible,
      dispatched,
      succeeded,
      failed,
      finished_at: new Date().toISOString(),
    },
    { run_id: runId }
  );

  return json(200, {
    ok: true,
    runId,
    summary: { scanned, eligible, dispatched, succeeded, failed },
  });
}

/* ──────────────────────────────────────────────
   GET — HEALTH
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  return json(200, {
    ok: true,
    route: "/api/autopost/run",
    status: "alive",
  });
}
