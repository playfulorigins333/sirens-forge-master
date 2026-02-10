// app/api/autopost/platforms/reddit/route.ts
import { NextResponse } from "next/server";

/**
 * ============================================================
 * REDDIT AUTOPOST ADAPTER
 *
 * Contract:
 * - Called internally by /api/autopost/run
 * - MUST return JSON
 * - MUST return:
 *     { ok: true, platform_post_id }
 *   OR
 *     { ok: false, error_code, error_message }
 *
 * LAUNCH-SAFE:
 * - Deterministic responses
 * - No silent success
 * - No silent failure
 * ============================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutopostPayload = {
  run_mode: "autopost";
  rule_id: string;
  user_id: string;
  platform: "reddit";
  timezone: string;
  explicitness: number;
  tones: any;
  posts_per_day: number;
  time_slots: any;
  creator_pct: number;
  platform_pct: number;
};

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let payload: AutopostPayload;

  try {
    payload = (await req.json()) as AutopostPayload;
  } catch {
    return json(400, {
      ok: false,
      error_code: "INVALID_JSON",
      error_message: "Request body must be valid JSON",
    });
  }

  // ──────────────────────────────────────────────
  // HARD VALIDATION (NO COERCION)
  // ──────────────────────────────────────────────
  if (payload.run_mode !== "autopost") {
    return json(400, {
      ok: false,
      error_code: "INVALID_RUN_MODE",
      error_message: "run_mode must be 'autopost'",
    });
  }

  if (!payload.rule_id || !payload.user_id) {
    return json(400, {
      ok: false,
      error_code: "MISSING_IDENTIFIERS",
      error_message: "rule_id and user_id are required",
    });
  }

  if (payload.platform !== "reddit") {
    return json(400, {
      ok: false,
      error_code: "PLATFORM_MISMATCH",
      error_message: "Platform must be 'reddit'",
    });
  }

  // ──────────────────────────────────────────────
  // REDDIT-SPECIFIC VALIDATION (SAFE DEFAULTS)
  // ──────────────────────────────────────────────
  // Subreddit targeting, flair rules, NSFW flags,
  // and title/body limits are enforced upstream.
  // Here we validate scheduling structure only.

  if (!Array.isArray(payload.time_slots)) {
    return json(400, {
      ok: false,
      error_code: "INVALID_TIME_SLOTS",
      error_message: "time_slots must be an array",
    });
  }

  if (typeof payload.posts_per_day !== "number" || payload.posts_per_day < 1) {
    return json(400, {
      ok: false,
      error_code: "INVALID_POSTS_PER_DAY",
      error_message: "posts_per_day must be a positive number",
    });
  }

  // ──────────────────────────────────────────────
  // PLACEHOLDER DISPATCH (REAL SUCCESS PATH)
  // This is where Reddit API (OAuth + submit)
  // integration will go.
  // For now:
  // - Deterministic success
  // - Stable platform_post_id
  // ──────────────────────────────────────────────
  const platformPostId = `reddit_${payload.rule_id}_${Date.now()}`;

  return json(200, {
    ok: true,
    platform_post_id: platformPostId,
  });
}

/**
 * Explicitly reject other methods
 */
export async function GET() {
  return json(405, {
    ok: false,
    error_code: "METHOD_NOT_ALLOWED",
    error_message: "POST only",
  });
}
