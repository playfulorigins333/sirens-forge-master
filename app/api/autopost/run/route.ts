import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutopostRule = {
  id: string;
  user_id: string;
  platform: string;
  content_mode: string;
  status: string;
  cadence_minutes?: number | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  payload?: any;
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

const supabaseAdmin = getSupabaseAdmin();

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

function isEligible(rule: AutopostRule, now: Date) {
  const next = parseDate(rule.next_run_at);
  if (next) return next <= now;
  return true;
}

async function dispatchToPlatform(rule: AutopostRule): Promise<DispatchResult> {
  const caption = rule.payload?.caption ?? "";

  if (!caption) {
    return { ok: false, error: "EMPTY_POST" };
  }

  return {
    ok: true,
    platform_post_id: `mock_${rule.platform}_${rule.id}`,
  };
}

function assertCronAuth(req: Request) {
  if (req.headers.get("x-vercel-cron") === "1") {
    return { ok: true as const };
  }

  const secret = process.env.AUTOPOST_CRON_SECRET;
  if (!secret) return { ok: false as const, error: "CRON_SECRET_NOT_SET" };

  if (req.headers.get("x-cron-secret") !== secret) {
    return { ok: false as const, error: "UNAUTHORIZED" };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const now = new Date();
  const runId = crypto.randomUUID();

  const { data: rules, error } = await supabaseAdmin
    .from("autopost_rules")
    .select("*")
    .eq("status", "APPROVED");

  if (error) {
    return json(500, { ok: false, error: error.message });
  }

  let scanned = 0;
  let succeeded = 0;
  let failed = 0;

  const results: any[] = [];

  for (const rule of (rules ?? []) as AutopostRule[]) {
    scanned++;

    if (!isEligible(rule, now)) continue;

    const res = await dispatchToPlatform(rule);

    if (res.ok === true) {
      succeeded++;

      await supabaseAdmin
        .from("autopost_rules")
        .update({
          last_run_at: nowISO(),
        })
        .eq("id", rule.id);

      results.push({
        rule_id: rule.id,
        ok: true,
        platform_post_id: res.platform_post_id,
      });
    } else {
      // 🔒 EXPLICIT NARROWING — THIS FIXES THE ERROR
      failed++;

      results.push({
        rule_id: rule.id,
        ok: false,
        error: res.error,
      });
    }
  }

  return json(200, {
    ok: true,
    runId,
    finishedAt: nowISO(),
    summary: { scanned, succeeded, failed },
    results,
  });
}

export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  return json(200, {
    ok: true,
    route: "/api/autopost/run",
  });
}
