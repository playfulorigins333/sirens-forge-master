// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ============================================================
 * AUTOPOST CRON EXECUTOR (LAUNCH-SAFE)
 * - Vercel Cron triggers via HTTP GET
 * - Server-side only
 * - Cloudflare compatible
 * - Observable Supabase writes
 * ============================================================
 */

/* ──────────────────────────────────────────────
   Env / Clients
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * IMPORTANT:
 * Vercel Cron ONLY injects Authorization header when
 * env var name is EXACTLY `CRON_SECRET`
 */
const CRON_SECRET =
  process.env.CRON_SECRET ||
  process.env.VERCEL_CRON_SECRET ||
  "";

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
  start_date: string | null;
  end_date: string | null;
  posts_per_day: number;
  time_slots: any;
  paused_at: string | null;
  revoked_at: string | null;
  accept_split: boolean;
  accept_automation: boolean;
  accept_control: boolean;
  creator_pct: number;
  platform_pct: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type DispatchResult = {
  ok: boolean;
  platform_post_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  details?: any;
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
   Cron Auth (STRICT)
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  if (!CRON_SECRET) {
    return { ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" };
  }

  const auth = req.headers.get("authorization") || "";

  if (auth === `Bearer ${CRON_SECRET}`) {
    return { ok: true as const };
  }

  return { ok: false as const, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   Eligibility
────────────────────────────────────────────── */
function isRunnableLifecycle(rule: AutopostRule) {
  if (String(rule.approval_state) !== "APPROVED") return false;
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
   Dispatch (webhook based)
────────────────────────────────────────────── */
const PLATFORM_WEBHOOK_ENV: Record<string, string> = {
  onlyfans: "AUTOPOST_WEBHOOK_ONLYFANS",
  fanvue: "AUTOPOST_WEBHOOK_FANVUE",
  fansly: "AUTOPOST_WEBHOOK_FANSLY",
};

function normalizePlatforms(selected_platforms: any): string[] {
  if (Array.isArray(selected_platforms)) {
    return selected_platforms.map(String).filter(Boolean);
  }
  return [];
}

async function dispatchToPlatformWebhook(params: {
  platform: string;
  rule: AutopostRule;
  dryRun: boolean;
}): Promise<DispatchResult> {
  const { platform, rule, dryRun } = params;

  const envKey = PLATFORM_WEBHOOK_ENV[platform.toLowerCase()];
  if (!envKey) {
    return {
      ok: false,
      error_code: "UNSUPPORTED_PLATFORM",
      error_message: `No adapter for ${platform}`,
      platform_post_id: null,
    };
  }

  const webhookUrl = process.env[envKey];
  if (!webhookUrl) {
    return {
      ok: false,
      error_code: "WEBHOOK_NOT_CONFIGURED",
      error_message: `Missing ${envKey}`,
      platform_post_id: null,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      platform_post_id: "dry_run",
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sf-source": "autopost",
      },
      body: JSON.stringify({
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
    });

    if (!res.ok) {
      return {
        ok: false,
        error_code: "DISPATCH_HTTP_ERROR",
        error_message: `HTTP ${res.status}`,
        platform_post_id: null,
      };
    }

    const data = await res.json().catch(() => null);
    const pid = data?.platform_post_id || data?.id || null;

    if (!pid) {
      return {
        ok: false,
        error_code: "INVALID_RESPONSE",
        error_message: "Missing platform_post_id",
        platform_post_id: null,
      };
    }

    return { ok: true, platform_post_id: String(pid) };
  } catch (e: any) {
    return {
      ok: false,
      error_code: "DISPATCH_EXCEPTION",
      error_message: e?.message || "Dispatch failed",
      platform_post_id: null,
    };
  }
}

/* ──────────────────────────────────────────────
   Core Executor
────────────────────────────────────────────── */
async function executeAutopost(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "SUPABASE_NOT_CONFIGURED" });
  }

  const dryRun =
    new URL(req.url).searchParams.get("dry") === "1";

  const startedAt = nowISO();
  const now = new Date();

  const runId = `run_${crypto.randomBytes(8).toString("hex")}`;

  const { data, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*");

  if (error) {
    return json(500, {
      ok: false,
      error: "RULE_QUERY_FAILED",
      details: error.message,
    });
  }

  const rules = (data || []) as AutopostRule[];

  const summary: RunSummary = {
    scanned: rules.length,
    eligible: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const rule of rules) {
    if (!isRunnableLifecycle(rule)) continue;
    if (!isEligibleNow(rule, now)) continue;

    summary.eligible++;

    const platforms = normalizePlatforms(rule.selected_platforms);
    for (const platform of platforms) {
      summary.dispatched++;

      const res = await dispatchToPlatformWebhook({
        platform,
        rule,
        dryRun,
      });

      if (res.ok) summary.succeeded++;
      else summary.failed++;
    }
  }

  await supabaseAdmin.from("autopost_runs").insert({
    run_id: runId,
    triggered_by: "vercel-cron",
    started_at: startedAt,
    finished_at: nowISO(),
    scanned: summary.scanned,
    eligible: summary.eligible,
    dispatched: summary.dispatched,
    succeeded: summary.succeeded,
    failed: summary.failed,
    dry_run: dryRun,
  });

  return json(200, { ok: true, runId, summary });
}

/* ──────────────────────────────────────────────
   GET (Cron)
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const health =
    new URL(req.url).searchParams.get("health") === "1";

  if (health) {
    return json(200, {
      ok: true,
      route: "/api/autopost/run",
      mode: "health",
    });
  }

  return executeAutopost(req);
}

/* ──────────────────────────────────────────────
   POST (internal manual)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  return executeAutopost(req);
}
