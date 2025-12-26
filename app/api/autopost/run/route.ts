// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
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
   Table shape (from your schema paste)
────────────────────────────────────────────── */
type AutopostRule = {
  id: string;
  user_id: string;

  enabled: boolean;
  selected_platforms: any; // jsonb (expected array)
  approval_state: "DRAFT" | "APPROVED" | "PAUSED" | "REVOKED" | string;

  timezone: string; // default America/New_York
  start_date: string | null; // date (YYYY-MM-DD)
  end_date: string | null; // date (YYYY-MM-DD)
  posts_per_day: number; // integer
  time_slots: any; // jsonb (expected array of "HH:MM" strings)

  next_run_at: string | null; // timestamptz
  last_run_at: string | null; // timestamptz

  // optional additional config the UI may store
  tones?: any;
  explicitness?: number;
};

type DispatchOk = {
  ok: true;
  platform: string;
  platform_post_id: string;
  details?: any;
};

type DispatchFail = {
  ok: false;
  platform: string;
  error: string;
  details?: any;
};

type DispatchResult = DispatchOk | DispatchFail;

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function nowISO() {
  return new Date().toISOString();
}

function parseISO(v?: string | null) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseHM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { h: hh, m: mm };
}

/**
 * Get "parts" of current time in a target IANA tz without external libs.
 * Returns {year, month, day, hour, minute, second} in that tz.
 */
function getTZParts(now: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);

  return { year, month, day, hour, minute, second };
}

/**
 * Convert a local time-in-timezone (YYYY-MM-DD + HH:MM) to an absolute Date.
 * NOTE: Without a full tz library, we do a best-effort conversion by using
 * Intl to compute the UTC timestamp that formats back to the requested local time.
 * This is sufficient for cron scheduling of time slots.
 */
function tzLocalToUTCDate(timeZone: string, y: number, mo: number, d: number, h: number, mi: number): Date {
  // Start with the UTC guess, then adjust until it matches the intended local time.
  // In practice, 0-2 iterations works for DST shifts.
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  for (let i = 0; i < 3; i++) {
    const p = getTZParts(guess, timeZone);
    const diffMinutes =
      (p.year - y) * 525600 +
      (p.month - mo) * 43200 +
      (p.day - d) * 1440 +
      (p.hour - h) * 60 +
      (p.minute - mi);

    if (diffMinutes === 0) break;
    guess = new Date(guess.getTime() - diffMinutes * 60_000);
  }
  return guess;
}

function withinDateWindow(rule: AutopostRule, tzNowParts: { year: number; month: number; day: number }) {
  const ymdToday = `${tzNowParts.year}-${String(tzNowParts.month).padStart(2, "0")}-${String(tzNowParts.day).padStart(2, "0")}`;

  if (rule.start_date && isYMD(rule.start_date) && ymdToday < rule.start_date) return false;
  if (rule.end_date && isYMD(rule.end_date) && ymdToday > rule.end_date) return false;
  return true;
}

/* ──────────────────────────────────────────────
   Schedule logic (REAL, from your schema)
   - approval_state must be APPROVED
   - enabled must be true
   - date window must allow today
   - time_slots drives posting times
   - next_run_at is computed if missing, and advanced after a successful dispatch
────────────────────────────────────────────── */
function computeNextRunAt(rule: AutopostRule, now: Date): string | null {
  const timeZone = rule.timezone || "America/New_York";
  const slots = safeArray(rule.time_slots)
    .map((s) => String(s))
    .map((s) => parseHM(s))
    .filter((x): x is { h: number; m: number } => !!x);

  if (slots.length === 0) return null;

  const tz = getTZParts(now, timeZone);
  if (!withinDateWindow(rule, tz)) return null;

  // Sort slots ascending
  slots.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));

  // Find next slot >= now (in tz)
  const nowMinutes = tz.hour * 60 + tz.minute;
  let candidate: { y: number; mo: number; d: number; h: number; mi: number } | null = null;

  for (const s of slots) {
    const slotMinutes = s.h * 60 + s.m;
    if (slotMinutes >= nowMinutes) {
      candidate = { y: tz.year, mo: tz.month, d: tz.day, h: s.h, mi: s.m };
      break;
    }
  }

  // Otherwise, next day first slot
  if (!candidate) {
    // increment day in tz by constructing a UTC date at noon and adding 24h, then re-reading tz parts
    const noonUTC = tzLocalToUTCDate(timeZone, tz.year, tz.month, tz.day, 12, 0);
    const tomorrowUTC = new Date(noonUTC.getTime() + 24 * 60 * 60_000);
    const tzt = getTZParts(tomorrowUTC, timeZone);

    // If end_date exists and tomorrow is beyond it, stop
    const ymdTomorrow = `${tzt.year}-${String(tzt.month).padStart(2, "0")}-${String(tzt.day).padStart(2, "0")}`;
    if (rule.end_date && isYMD(rule.end_date) && ymdTomorrow > rule.end_date) return null;

    candidate = { y: tzt.year, mo: tzt.month, d: tzt.day, h: slots[0].h, mi: slots[0].m };
  }

  const dt = tzLocalToUTCDate(timeZone, candidate.y, candidate.mo, candidate.d, candidate.h, candidate.mi);
  return dt.toISOString();
}

function isEligibleToRun(rule: AutopostRule, now: Date) {
  if (!rule.enabled) return false;
  if (rule.approval_state !== "APPROVED") return false;

  const nra = parseISO(rule.next_run_at);
  if (!nra) return false;
  return nra.getTime() <= now.getTime();
}

/* ──────────────────────────────────────────────
   REAL Dispatch Layer (NO MOCKS)
   We refuse to "pretend success".

   Supported "real" dispatch modes:

   1) WEBHOOK MODE (works today)
      - If a platform entry is an object like:
        { "platform": "webhook", "webhook_url": "https://..." }
      - OR platform string starts with "webhook:" e.g.
        "webhook:https://example.com/hook"
      We will POST a JSON payload to that URL.

   2) Any other platform => HARD FAIL until you implement adapter.
────────────────────────────────────────────── */
async function dispatchWebhook(webhookUrl: string, rule: AutopostRule, platformLabel: string): Promise<DispatchResult> {
  try {
    const controller = new AbortController();
    const timeoutMs = clampInt(process.env.AUTOPOST_HTTP_TIMEOUT_MS, 1000, 30_000, 12_000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const body = {
      rule_id: rule.id,
      user_id: rule.user_id,
      platform: platformLabel,
      approval_state: rule.approval_state,
      enabled: rule.enabled,
      timezone: rule.timezone,
      scheduled_for: rule.next_run_at,
      // You can expand this later to include caption/media/etc.
      payload: {
        explicitness: rule.explicitness ?? null,
        tones: rule.tones ?? null,
      },
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((e: any) => {
      throw new Error(e?.message ? `FETCH_FAILED: ${e.message}` : "FETCH_FAILED");
    });

    clearTimeout(t);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        platform: platformLabel,
        error: `WEBHOOK_HTTP_${res.status}`,
        details: text ? { response: text.slice(0, 2000) } : undefined,
      };
    }

    const text = await res.text().catch(() => "");
    // If the receiver returns JSON with an id, keep it; otherwise generate a deterministic id.
    let platform_post_id = "";
    try {
      const parsed = text ? JSON.parse(text) : null;
      platform_post_id = parsed?.platform_post_id || parsed?.id || "";
    } catch {
      // ignore parse errors; fall through
    }

    if (!platform_post_id) {
      platform_post_id = `webhook_${cryptoRandomId(rule.id, platformLabel, rule.next_run_at || "")}`;
    }

    return {
      ok: true,
      platform: platformLabel,
      platform_post_id,
      details: text ? { response: text.slice(0, 2000) } : undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      platform: platformLabel,
      error: e?.message || "WEBHOOK_DISPATCH_FAILED",
    };
  }
}

function cryptoRandomId(...parts: string[]) {
  // Node runtime: crypto is available via global WebCrypto in Node 18+, but we avoid imports here.
  // Use a simple deterministic hash-like fallback without adding deps.
  const s = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function normalizeSelectedPlatforms(rule: AutopostRule): Array<{ platform: string; webhook_url?: string }> {
  const raw = safeArray(rule.selected_platforms);

  // Accept:
  // - ["twitter","fansly"] (strings)
  // - [{platform:"webhook", webhook_url:"https://..."}]
  // - ["webhook:https://..."]
  const out: Array<{ platform: string; webhook_url?: string }> = [];

  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s.toLowerCase().startsWith("webhook:")) {
        const url = s.slice("webhook:".length).trim();
        if (url) out.push({ platform: "webhook", webhook_url: url });
        else out.push({ platform: s }); // will hard-fail later
      } else {
        out.push({ platform: s });
      }
      continue;
    }

    if (item && typeof item === "object") {
      const p = String((item as any).platform || (item as any).id || (item as any).name || "").trim();
      const webhook_url = typeof (item as any).webhook_url === "string" ? (item as any).webhook_url.trim() : undefined;
      if (p) out.push({ platform: p, webhook_url });
      continue;
    }
  }

  return out;
}

async function dispatchToPlatform(rule: AutopostRule): Promise<DispatchResult[]> {
  const platforms = normalizeSelectedPlatforms(rule);

  if (platforms.length === 0) {
    return [
      {
        ok: false,
        platform: "none",
        error: "NO_SELECTED_PLATFORMS",
      },
    ];
  }

  const results: DispatchResult[] = [];

  for (const p of platforms) {
    const name = String(p.platform || "").toLowerCase();

    // ✅ REAL dispatch mode available today: webhook
    if (name === "webhook") {
      if (!p.webhook_url) {
        results.push({
          ok: false,
          platform: "webhook",
          error: "WEBHOOK_URL_MISSING",
        });
        continue;
      }

      results.push(await dispatchWebhook(p.webhook_url, rule, "webhook"));
      continue;
    }

    // ❌ Everything else MUST hard-fail until you implement the real adapter.
    // This is production-honest: we do not pretend posts were made.
    results.push({
      ok: false,
      platform: name || "unknown",
      error: `AUTPOST_PLATFORM_NOT_IMPLEMENTED:${name || "unknown"}`,
      details: {
        hint:
          "Implement a real adapter for this platform (OAuth/API or headless automation). Until then, rules will fail (not fake succeed).",
      },
    });
  }

  return results;
}

/* ──────────────────────────────────────────────
   Executor
────────────────────────────────────────────── */
async function runExecutor(opts: { dryRun: boolean; maxRules: number }) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, error: "SUPABASE_NOT_CONFIGURED" };
  }

  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date();

  // Pull APPROVED rules (lifecycle gate)
  const { data: approved, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .eq("approval_state", "APPROVED")
    .limit(opts.maxRules);

  if (error) {
    return { ok: false, error: "RULE_QUERY_FAILED", details: error.message, runId };
  }

  const rules = (approved ?? []) as AutopostRule[];

  // Ensure next_run_at is populated for APPROVED+enabled rules that are missing it
  // This prevents "eligible never becomes true" if UI didn’t set next_run_at yet.
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.next_run_at) continue;

    const computed = computeNextRunAt(r, now);
    if (!computed) continue;

    await supabaseAdmin
      .from("autopost_rules")
      .update({ next_run_at: computed })
      .eq("id", r.id);
    r.next_run_at = computed;
  }

  let scanned = rules.length;
  let eligible = 0;
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;

  const results: Array<{
    rule_id: string;
    user_id: string;
    eligible: boolean;
    dispatched: boolean;
    platform_results?: DispatchResult[];
  }> = [];

  for (const rule of rules) {
    const canRun = isEligibleToRun(rule, now);

    if (!canRun) {
      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        eligible: false,
        dispatched: false,
      });
      continue;
    }

    eligible++;

    if (opts.dryRun) {
      results.push({
        rule_id: rule.id,
        user_id: rule.user_id,
        eligible: true,
        dispatched: false,
        platform_results: [
          {
            ok: true,
            platform: "dry_run",
            platform_post_id: "dry_run",
            details: { note: "No outbound calls made (x-autopost-dry-run=1)." },
          },
        ],
      });
      continue;
    }

    dispatched++;

    const platformResults = await dispatchToPlatform(rule);

    const anyOk = platformResults.some((r) => r.ok);
    const anyFail = platformResults.some((r) => !r.ok);

    if (anyOk) succeeded++;
    if (anyFail) failed++;

    // Always record last_run_at attempt when it was eligible and we tried dispatch
    // Advance next_run_at based on time_slots so it doesn't re-fire immediately.
    const next = computeNextRunAt(rule, new Date(now.getTime() + 60_000)); // +1m to move past current slot
    await supabaseAdmin
      .from("autopost_rules")
      .update({
        last_run_at: nowISO(),
        next_run_at: next,
      })
      .eq("id", rule.id);

    results.push({
      rule_id: rule.id,
      user_id: rule.user_id,
      eligible: true,
      dispatched: true,
      platform_results: platformResults,
    });
  }

  return {
    ok: true,
    runId,
    startedAt: nowISO(),
    finishedAt: nowISO(),
    dryRun: opts.dryRun,
    maxRules: opts.maxRules,
    summary: { scanned, eligible, dispatched, succeeded, failed },
    results,
  };
}

/* ──────────────────────────────────────────────
   GET — Vercel Cron (GET-only)
   Vercel cron hits GET. No auth header supported.
────────────────────────────────────────────── */
export async function GET(req: Request) {
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);

  const result = await runExecutor({ dryRun, maxRules });
  return json(200, result);
}

/* ──────────────────────────────────────────────
   POST — Manual / internal (Auth required)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  const secret = process.env.VERCEL_CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const dryRun = req.headers.get("x-autopost-dry-run") === "1";
  const maxRules = clampInt(process.env.AUTOPOST_RUN_MAX_RULES, 1, 500, 100);

  const result = await runExecutor({ dryRun, maxRules });
  return json(200, result);
}
