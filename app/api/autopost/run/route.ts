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
 * - We execute on GET (normal) and allow ?health=1 for health check
 * - Security: Authorization: Bearer <secret>
 * ============================================================
 */

/* ──────────────────────────────────────────────
   Env / Clients
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// NOTE:
// - Vercel Cron sends Authorization: Bearer <CRON_SECRET> ONLY when env var is named CRON_SECRET in Vercel.
// - We still allow VERCEL_CRON_SECRET as a fallback for manual testing / legacy.
const CRON_SECRET =
  process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ──────────────────────────────────────────────
   Types (based on your DB schema)
────────────────────────────────────────────── */
type AutopostRule = {
  id: string;
  user_id: string;

  approval_state: string; // DRAFT | APPROVED | PAUSED | REVOKED
  enabled: boolean;

  selected_platforms: any; // jsonb array
  explicitness: number;
  tones: any; // jsonb array
  timezone: string;

  start_date: string | null; // date
  end_date: string | null; // date
  posts_per_day: number;
  time_slots: any; // jsonb array

  paused_at: string | null;
  revoked_at: string | null;

  accept_split: boolean;
  accept_automation: boolean;
  accept_control: boolean;

  creator_pct: number;
  platform_pct: number;

  next_run_at: string | null; // timestamptz
  last_run_at: string | null; // timestamptz

  created_at: string;
  updated_at: string;
};

// IMPORTANT FIX:
// Use a single object type with optional fields so TS never loops on union narrowing.
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
   Small helpers
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
  if (String(rule.approval_state) !== "APPROVED") return false;
  if (!rule.enabled) return false;
  if (rule.revoked_at) return false;
  if (rule.paused_at) return false;
  return true;
}

function isEligibleNow(rule: AutopostRule, now: Date) {
  const nra = parseDate(rule.next_run_at);
  if (!nra) return false; // safe default
  return nra.getTime() <= now.getTime();
}

/* ──────────────────────────────────────────────
   Platform Dispatch (REAL, NO SILENT SUCCESS)
────────────────────────────────────────────── */
const PLATFORM_WEBHOOK_ENV: Record<string, string> = {
  onlyfans: "AUTOPOST_WEBHOOK_ONLYFANS",
  fanvue: "AUTOPOST_WEBHOOK_FANVUE",
  fansly: "AUTOPOST_WEBHOOK_FANSLY",
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePlatforms(selected_platforms: any): string[] {
  if (Array.isArray(selected_platforms)) {
    return selected_platforms.map((p) => String(p)).filter(Boolean);
  }
  return [];
}

async function dispatchToPlatformWebhook(params: {
  platform: string;
  rule: AutopostRule;
  dryRun: boolean;
}): Promise<DispatchResult> {
  const { platform, rule, dryRun } = params;

  const envKey = PLATFORM_WEBHOOK_ENV[String(platform).toLowerCase()];
  if (!envKey) {
    return {
      ok: false,
      error_code: "UNSUPPORTED_PLATFORM",
      error_message: `No adapter registered for platform '${platform}'`,
      platform_post_id: null,
    };
  }

  const webhookUrl = process.env[envKey];
  if (!webhookUrl) {
    return {
      ok: false,
      error_code: "PLATFORM_WEBHOOK_NOT_CONFIGURED",
      error_message: `Missing env var ${envKey}`,
      platform_post_id: null,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      platform_post_id: "dry_run",
      error_code: null,
      error_message: null,
      details: { platform, adapter: "webhook", envKey },
    };
  }

  const body = {
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
  };

  try {
    const res = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sf-source": "autopost-executor",
        },
        body: JSON.stringify(body),
      },
      clampInt(process.env.AUTOPOST_DISPATCH_TIMEOUT_MS, 2_000, 60_000, 15_000)
    );

    const text = await res.text().catch(() => "");
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        error_code: "PLATFORM_DISPATCH_HTTP_ERROR",
        error_message: `Webhook returned ${res.status}`,
        platform_post_id: null,
        details: { status: res.status, body: parsed ?? text },
      };
    }

    const platformPostId =
      parsed?.platform_post_id || parsed?.id || parsed?.post_id || null;

    const okFlag = parsed?.ok === true || parsed?.success === true;

    if (!okFlag || !platformPostId) {
      return {
        ok: false,
        error_code: "PLATFORM_DISPATCH_INVALID_RESPONSE",
        error_message:
          "Webhook did not return explicit success + platform_post_id",
        platform_post_id: null,
        details: { body: parsed ?? text },
      };
    }

    return {
      ok: true,
      platform_post_id: String(platformPostId),
      error_code: null,
      error_message: null,
      details: parsed,
    };
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Dispatch timeout"
        : typeof e?.message === "string"
          ? e.message
          : "Dispatch failed";
    return {
      ok: false,
      error_code: "PLATFORM_DISPATCH_EXCEPTION",
      error_message: msg,
      platform_post_id: null,
      details: { platform, envKey },
    };
  }
}

/* ──────────────────────────────────────────────
   DB Writes (Observability)
────────────────────────────────────────────── */
async function insertRunRow(args: {
  run_id: string;
  triggered_by: string;
  started_at: string;
  finished_at: string;
  summary: RunSummary;
  dry_run: boolean;
}) {
  const { run_id, triggered_by, started_at, finished_at, summary, dry_run } =
    args;

  const { error } = await supabaseAdmin.from("autopost_runs").insert({
    run_id,
    triggered_by,
    started_at,
    finished_at,
    scanned: summary.scanned,
    eligible: summary.eligible,
    dispatched: summary.dispatched,
    succeeded: summary.succeeded,
    failed: summary.failed,
    dry_run,
  });

  if (error) {
    // never crash the run because logging failed
    // eslint-disable-next-line no-console
    console.error("[autopost_runs insert error]", error);
  }
}

async function insertRunResultRow(row: {
  run_id: string;
  rule_id: string;
  user_id: string;
  platform: string;
  eligible: boolean;
  dispatched: boolean;
  success: boolean | null;
  error_code: string | null;
  error_message: string | null;
  platform_post_id: string | null;
}) {
  const { error } = await supabaseAdmin
    .from("autopost_run_results")
    .insert(row);

  if (error) {
    // never crash the run because logging failed
    // eslint-disable-next-line no-console
    console.error("[autopost_run_results insert error]", error);
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

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dry") === "1" ||
    req.headers.get("x-autopost-dry-run") === "1";

  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);
  const triggeredBy =
    req.headers.get("user-agent")?.includes("vercel-cron")
      ? "vercel-cron"
      : "manual";

  const startedAt = nowISO();
  const now = new Date();

  const runId = `run_${crypto.randomBytes(4).toString("hex")}_${crypto
    .randomBytes(3)
    .toString("hex")}`;

  const { data, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .limit(maxRules);

  if (error) {
    return json(500, {
      ok: false,
      error: "RULE_QUERY_FAILED",
      details: error.message,
      runId,
    });
  }

  const rules = (data ?? []) as AutopostRule[];

  const summary: RunSummary = {
    scanned: rules.length,
    eligible: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const rule of rules) {
    try {
      if (!isRunnableLifecycle(rule)) continue;

      const eligible = isEligibleNow(rule, now);
      if (!eligible) {
        await insertRunResultRow({
          run_id: runId,
          rule_id: rule.id,
          user_id: rule.user_id,
          platform: "MULTI",
          eligible: false,
          dispatched: false,
          success: null,
          error_code: null,
          error_message: null,
          platform_post_id: null,
        });
        continue;
      }

      summary.eligible += 1;

      const platforms = normalizePlatforms(rule.selected_platforms);
      if (platforms.length === 0) {
        summary.dispatched += 1;
        summary.failed += 1;

        await insertRunResultRow({
          run_id: runId,
          rule_id: rule.id,
          user_id: rule.user_id,
          platform: "MULTI",
          eligible: true,
          dispatched: true,
          success: false,
          error_code: "NO_PLATFORMS_SELECTED",
          error_message: "selected_platforms is empty",
          platform_post_id: null,
        });
        continue;
      }

      let anySuccess = false;

      for (const platform of platforms) {
        summary.dispatched += 1;

        const res = await dispatchToPlatformWebhook({
          platform,
          rule,
          dryRun,
        });

        if (res.ok) {
          anySuccess = true;
          summary.succeeded += 1;

          await insertRunResultRow({
            run_id: runId,
            rule_id: rule.id,
            user_id: rule.user_id,
            platform,
            eligible: true,
            dispatched: true,
            success: true,
            error_code: null,
            error_message: null,
            platform_post_id: res.platform_post_id ? String(res.platform_post_id) : null,
          });
        } else {
          summary.failed += 1;

          await insertRunResultRow({
            run_id: runId,
            rule_id: rule.id,
            user_id: rule.user_id,
            platform,
            eligible: true,
            dispatched: true,
            success: false,
            error_code: res.error_code ? String(res.error_code) : "DISPATCH_FAILED",
            error_message: res.error_message ? String(res.error_message) : "Dispatch failed",
            platform_post_id: null,
          });
        }
      }

      if (anySuccess && !dryRun) {
        const bumpMinutes = clampInt(
          process.env.AUTOPOST_MIN_INTERVAL_MINUTES,
          1,
          1440,
          5
        );
        const next = new Date(now.getTime() + bumpMinutes * 60_000).toISOString();

        await supabaseAdmin
          .from("autopost_rules")
          .update({
            last_run_at: now.toISOString(),
            next_run_at: next,
            updated_at: now.toISOString(),
          })
          .eq("id", rule.id);
      }
    } catch (e: any) {
      summary.failed += 1;

      await insertRunResultRow({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: "MULTI",
        eligible: true,
        dispatched: true,
        success: false,
        error_code: "RULE_EXECUTION_EXCEPTION",
        error_message:
          typeof e?.message === "string" ? e.message : "Rule execution failed",
        platform_post_id: null,
      });

      continue;
    }
  }

  const finishedAt = nowISO();

  await insertRunRow({
    run_id: runId,
    triggered_by: triggeredBy,
    started_at: startedAt,
    finished_at: finishedAt,
    summary,
    dry_run: dryRun,
  });

  return json(200, {
    ok: true,
    runId,
    startedAt,
    finishedAt,
    dryRun,
    maxRules,
    summary,
  });
}

/* ──────────────────────────────────────────────
   GET
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const health = url.searchParams.get("health") === "1";

  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  if (health) {
    return json(200, {
      ok: true,
      route: "/api/autopost/run",
      mode: "health",
      expects: "GET + Authorization: Bearer <CRON_SECRET>",
    });
  }

  return executeAutopost(req);
}

/* ──────────────────────────────────────────────
   POST (manual internal trigger)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  return executeAutopost(req);
}
