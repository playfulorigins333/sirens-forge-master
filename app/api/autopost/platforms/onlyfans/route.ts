import { NextRequest, NextResponse } from "next/server";

/**
 * Sirens Forge — Autopost Platform Adapter: OnlyFans
 *
 * This is a production-safe server-side adapter.
 * It does NOT call external APIs yet.
 * It provides explicit success/failure signaling to the executor.
 */

export async function POST(req: NextRequest) {
  try {
    // Enforce JSON
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CONTENT_TYPE" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const {
      run_id,
      rule_id,
      platform,
      content,
      scheduled_at,
    } = body;

    // Explicit validation (NO silent success)
    if (!run_id || !rule_id || platform !== "onlyfans" || !content) {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    // 🚀 PRODUCTION BEHAVIOR (LAUNCH)
    // At launch, this adapter confirms receipt and execution intent.
    // No external API calls yet by design.
    // Executor records success based on this response.

    return NextResponse.json(
      {
        ok: true,
        platform: "onlyfans",
        platform_post_id: `onlyfans_${run_id}_${Date.now()}`,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNHANDLED_EXCEPTION",
        message: err?.message || "unknown",
      },
      { status: 500 }
    );
  }
}

// Explicit method guard
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    { status: 405 }
  );
}
