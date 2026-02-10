// app/api/autopost/platforms/onlyfans/route.ts
import { NextResponse } from "next/server";

/**
 * ============================================================
 * ONLYFANS AUTOPOST ADAPTER (LAUNCH-SAFE)
 *
 * Aligned to executor contract.
 * No external API calls yet by design.
 *
 * Contract:
 * - Input matches executor payload
 * - Output MUST be:
 *     { ok: true, platform_post_id }
 *   OR
 *     { ok: false, error_code, error_message }
 * ============================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutopostPayload = {
  run_mode: "autopost";
  rule_id: string;
  user_id: string;
  platform: "onlyfans";
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

  // ──────────────────────────────────────────────
  // Enforce JSON
  // ──────────────────────────────────────────────
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
  // HARD VALIDATION (NO SILENT COERCION)
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

  if (payload.platform !== "onlyfans") {
    return json(400, {
      ok: false,
      error_code: "PLATFORM_MISMATCH",
      error_message: "Platform must be 'onlyfans'",
    });
  }

  if (!Array.isArray(payload.time_slots)) {
    return json(400, {
      ok: false,
      error_code: "INVALID_TIME_SLOTS",
      error_message: "time_slots must be an array",
    });
  }

  // ──────────────────────────────────────────────
  // LAUNCH BEHAVIOR (NO EXTERNAL API YET)
  // Executor records success based on this response.
  // ──────────────────────────────────────────────
  const platformPostId = `onlyfans_${payload.rule_id}_${Date.now()}`;

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
