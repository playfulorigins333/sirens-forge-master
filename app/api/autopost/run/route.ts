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
   Types (NO UNION TYPES — avoids TS loops)
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

  selected_platforms: any; // jsonb (expected array)
  payload: any; // jsonb
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
   Vercel Cron Auth (Authorization: Bearer ...)
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  const expected = process.env.VERCEL_CRON_SECRET;
  if (!expected) return { ok: false as const, error: "CRON_SECRET_NOT_SET" };

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) return { ok: false as const, error: "UNAUTHORIZED" };

  return { ok: true as const };
}

/* ──────────────────────────────────────────────
   Lifecycle Enforcement (LOCKED RULES)
────────────────────────────────────────────── */
function lifecycleBlocksRun(rule: AutopostRule): { blocked: boolean; reason?: string } {
  // 🛑 NEVER RUN AGAIN if revoked
  if (rule.approval_state === "REVOKED") return { blocked: true, reason: "REVOKED_STATE" };
  if (rule.revoked_at) return { blocked: true, reason: "REVOKED_AT_SET" };

  // ⏸️ DO NOT RUN if paused
  if (rule.approval_state === "PAUSED") return { blocked: true, reason: "PAUSED_STATE" };
  if (rule.paused_at) return { blocked: true, reason: "PAUSED_AT_SET" };

  // ✅ only APPROVED is eligible to run
  if (rule.approval_state !== "APPROVED") return { blocked: true, reason: "NOT_APPROVED" };

  // ✅ enabled must be true
  if (!rule.enabled) return { blocked: true, reason: "DISABLED" };

  return { blocked: false };
}

function isEligibleByTime(rule: AutopostRule, now: Date): boolean {
  const next = parseDate(rule.next_run_at);
  if (!next) return false;
  return next.getTime() <= now.getTime();
}

function normalizePlatforms(selected_platforms: any): string[] {
  // expected: jsonb array of strings
  if (Array.isArray(selected_platforms)) {
    return selected_platforms
      .map((x) => (typeof x === "string" ? x : null))
      .filter((x): x is string => !!x);
  }
  return [];
}

/* ──────────────────────────────────────────────
   Platform Dispatch (Launch-safe)
   - webhook:<url> supported
   - everything else hard-fails (NO silent success)
────────────────────────────────────────────── */
async function dispatchToPlatform(
  platform: string,
  rule: AutopostRule
): Promise<DispatchEnvelope> {
  // webhook adapter
  if (platform.startsWith("webhook:")) {
    const url = platform.slice("webhook:".length).trim();
    if (!url) {
      return {
        attempted: true,
        success: false,
        platform_post_id: null,
        error_code: "WEBHOOK_URL_MISSING",
        error_message: "platform is webhook: but no URL provided",
      };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_id: rule.id,
          user_id: rule.user_id,
          platform,
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

  // hard-fail unsupported platforms (launch-safe)
  return {
    attempted: true,
    success: false,
    platform_post_id: null,
    error_code: "PLATFORM_NOT_SUPPORTED",
    error_message: `Unsupported platform adapter: ${platform}`,
  };
}

/* ──────────────────────────────────────────────
   Best-effort logging helpers (NEVER fatal)
────────────────────────────────────────────── */
async function safeInsertRun(row: any) {
  try {
    const { error } = await supabaseAdmin.from("autopost_runs").insert(row);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

async function safeUpdateRun(run_id: string, patch: any) {
  try {
    const { error } = await supabaseAdmin.from("autopost_runs").update(patch).eq("run_id", run_id);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

async function safeInsertResult(row: any) {
  try {
    const { error } = await supabaseAdmin.from("autopost_run_results").insert(row);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
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

  const runId = `run_${crypto.randomUUID()}`;
  const now = new Date();
  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);
  const dryRun = req.headers.get("x-autopost-dry-run") === "1";

  // Pull rules that are APPROVED-ish candidates; lifecycle/time checks happen in code
  const { data: rules, error: rulesErr } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .limit(maxRules);

  if (rulesErr) {
    return json(500, { ok: false, error: "RULE_QUERY_FAILED", details: rulesErr.message, runId });
  }

  const allRules = (rules ?? []) as AutopostRule[];

  let scanned = allRules.length;
  let eligible = 0;

  // counts reflect per-platform dispatch attempts
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;

  // Create run row (best-effort)
  await safeInsertRun({
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
    // Hard lifecycle block
    const block = lifecycleBlocksRun(rule);
    if (block.blocked) {
      // Still log one row for rule visibility (platform = "rule")
      await safeInsertResult({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: "rule",
        eligible: false,
        dispatched: false,
        success: null,
        error_code: "LIFECYCLE_BLOCK",
        error_message: block.reason || "blocked",
        platform_post_id: null,
      });
      continue;
    }

    // Time eligibility check
    const timeOk = isEligibleByTime(rule, now);
    if (!timeOk) {
      await safeInsertResult({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: "rule",
        eligible: false,
        dispatched: false,
        success: null,
        error_code: "NOT_YET_DUE",
        error_message: "next_run_at is in the future or missing/invalid",
        platform_post_id: null,
      });
      continue;
    }

    // Eligible rule
    eligible++;

    const platforms = normalizePlatforms(rule.selected_platforms);

    if (platforms.length === 0) {
      // Eligible but impossible to dispatch
      dispatched++;
      failed++;

      await safeInsertResult({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform: "rule",
        eligible: true,
        dispatched: true,
        success: false,
        error_code: "NO_PLATFORMS_SELECTED",
        error_message: "selected_platforms is empty",
        platform_post_id: null,
      });

      continue;
    }

    // Dispatch per platform (isolated failures)
    let anySuccess = false;

    for (const platform of platforms) {
      if (dryRun) {
        // Dry run: do not attempt delivery
        await safeInsertResult({
          run_id: runId,
          rule_id: rule.id,
          user_id: rule.user_id,
          platform,
          eligible: true,
          dispatched: false,
          success: null,
          error_code: "DRY_RUN",
          error_message: "dry run: no dispatch attempted",
          platform_post_id: null,
        });
        continue;
      }

      dispatched++;

      const env = await dispatchToPlatform(platform, rule);

      if (env.success) {
        anySuccess = true;
        succeeded++;
      } else {
        failed++;
      }

      await safeInsertResult({
        run_id: runId,
        rule_id: rule.id,
        user_id: rule.user_id,
        platform,
        eligible: true,
        dispatched: env.attempted,
        success: env.success,
        error_code: env.error_code,
        error_message: env.error_message,
        platform_post_id: env.platform_post_id,
      });
    }

    // Update last_run_at on success (do NOT touch next_run_at)
    // If you have DB triggers that compute next_run_at, they can key off last_run_at.
    if (!dryRun && anySuccess) {
      try {
        await supabaseAdmin
          .from("autopost_rules")
          .update({ last_run_at: now.toISOString() })
          .eq("id", rule.id);
      } catch {
        // non-fatal
      }
    }
  }

  // Update run totals (best-effort)
  await safeUpdateRun(runId, {
    eligible,
    dispatched,
    succeeded,
    failed,
    finished_at: new Date().toISOString(),
  });

  return json(200, {
    ok: true,
    runId,
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    maxRules,
    summary: { scanned, eligible, dispatched, succeeded, failed },
  });
}

/* ──────────────────────────────────────────────
   GET — Health
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
