// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ============================================================
 * AUTOPOST CRON EXECUTOR (LOCKED FOR LAUNCH)
 * ============================================================
 */

/* ──────────────────────────────────────────────
   Env / Clients
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CRON_SECRET =
  process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "";

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */
type AutopostRule = {
  id: string;
  user_id: string;
  approval_state: string;
  enabled: boolean;
  selected_platforms: any;
  explicitness: number;
  tones: any;
  timezone: string;
  posts_per_day: number;
  time_slots: any;
  creator_pct: number;
  platform_pct: number;
  next_run_at: string | null;
  last_run_at: string | null;
  paused_at: string | null;
  revoked_at: string | null;
};

type DispatchResult = {
  ok: boolean;
  platform_post_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

type RunSummary = {
  scanned: number;
  eligible: number;
  dispatched: number;
  succeeded: number;
  failed: number;
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
   Cron Auth
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  if (!CRON_SECRET) {
    return { ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" };
  }

  const auth = req.headers.get("authorization") || "";
  const xCron = req.headers.get("x-vercel-cron-secret") || "";

  if (auth === `Bearer ${CRON_SECRET}`) return { ok: true as const };
  if (xCron === CRON_SECRET) return { ok: true as const };

  return { ok: false as const, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   Eligibility
────────────────────────────────────────────── */
function isRunnableLifecycle(rule: AutopostRule) {
  if (rule.approval_state !== "APPROVED") return false;
  if (!rule.enabled) return false;
  if (rule.revoked_at) return false;
  if (rule.paused_at) return false;
  return true;
}

function isEligibleNow(rule: AutopostRule, now: Date) {
  const nra = parseDate(rule.next_run_at);
  if (!nra) return false;
  return nra.getTime() <= now.getTime();
}

/* ──────────────────────────────────────────────
   PLATFORM ROUTING (FIXED)
────────────────────────────────────────────── */
const PLATFORM_WEBHOOK_ENV: Record<string, string> = {
  onlyfans: "AUTOPOST_WEBHOOK_ONLYFANS",
  fansly: "AUTOPOST_WEBHOOK_FANSLY",
  fanvue: "AUTOPOST_WEBHOOK_FANVUE",

  // ✅ FIX — newly added platforms
  manyvids: "AUTOPOST_WEBHOOK_MANYVIDS",
  x: "AUTOPOST_WEBHOOK_X",
  reddit: "AUTOPOST_WEBHOOK_REDDIT",
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizePlatforms(selected_platforms: any): string[] {
  return Array.isArray(selected_platforms)
    ? selected_platforms.map((p) => String(p))
    : [];
}

async function dispatchToPlatformWebhook(
  platform: string,
  rule: AutopostRule,
  dryRun: boolean
): Promise<DispatchResult> {
  const envKey = PLATFORM_WEBHOOK_ENV[platform];
  if (!envKey) {
    return {
      ok: false,
      error_code: "UNSUPPORTED_PLATFORM",
      error_message: `No adapter registered for platform '${platform}'`,
    };
  }

  const url = process.env[envKey];
  if (!url) {
    return {
      ok: false,
      error_code: "PLATFORM_WEBHOOK_NOT_CONFIGURED",
      error_message: `Missing env var ${envKey}`,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      platform_post_id: `dry_${platform}_${Date.now()}`,
    };
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_mode: "autopost",
        rule_id: rule.id,
        user_id: rule.user_id,
        platform,
        timezone: rule.timezone,
        explicitness: rule.explicitness,
        tones: rule.tones,
        posts_per_day: rule.posts_per_day,
        time_slots: rule.time_slots,
        creator_pct: rule.creator_pct,
        platform_pct: rule.platform_pct,
      }),
    },
    clampInt(process.env.AUTOPOST_DISPATCH_TIMEOUT_MS, 2000, 60000, 15000)
  );

  const text = await res.text();
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  if (!res.ok || !parsed?.ok) {
    return {
      ok: false,
      error_code: "PLATFORM_DISPATCH_HTTP_ERROR",
      error_message: `Webhook returned ${res.status}`,
    };
  }

  return {
    ok: true,
    platform_post_id: parsed.platform_post_id ?? null,
  };
}

/* ──────────────────────────────────────────────
   DB Writes
────────────────────────────────────────────── */
async function insertRunResult(row: any) {
  const { error } = await supabaseAdmin
    .from("autopost_run_results")
    .insert(row);

  if (error) {
    throw error;
  }
}

async function insertRun(row: any) {
  await supabaseAdmin.from("autopost_runs").insert(row);
}

/* ──────────────────────────────────────────────
   Executor
────────────────────────────────────────────── */
async function executeAutopost(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const dryRun =
    new URL(req.url).searchParams.get("dry") === "1";

  const startedAt = nowISO();
  const now = new Date();
  const runId = `run_${crypto.randomBytes(8).toString("hex")}`;

  const { data: rules } = await supabaseAdmin
    .from("autopost_rules")
    .select("*");

  const summary: RunSummary = {
    scanned: rules?.length ?? 0,
    eligible: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const rule of rules ?? []) {
    if (!isRunnableLifecycle(rule)) continue;
    if (!isEligibleNow(rule, now)) continue;

    summary.eligible++;

    for (const platform of normalizePlatforms(rule.selected_platforms)) {
      summary.dispatched++;

      const result = await dispatchToPlatformWebhook(
        platform,
        rule,
        dryRun
      );

      if (result.ok) summary.succeeded++;
      else summary.failed++;

      await insertRunResult({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform,
        eligible: true,
        dispatched: true,
        success: result.ok,
        error_code: result.ok ? null : result.error_code,
        error_message: result.ok ? null : result.error_message,
        platform_post_id: result.platform_post_id ?? null,
      });
    }

    await supabaseAdmin
      .from("autopost_rules")
      .update({
        last_run_at: nowISO(),
        next_run_at: new Date(
          now.getTime() + 5 * 60000
        ).toISOString(),
      })
      .eq("id", rule.id);
  }

  await insertRun({
    run_id: runId,
    triggered_by: "cron",
    started_at: startedAt,
    finished_at: nowISO(),
    ...summary,
    dry_run: dryRun,
  });

  return json(200, { ok: true, runId, summary });
}

/* ──────────────────────────────────────────────
   Routes
────────────────────────────────────────────── */
export async function GET(req: Request) {
  return executeAutopost(req);
}

export async function POST(req: Request) {
  return executeAutopost(req);
}
