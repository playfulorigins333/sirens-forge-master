import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutopostPayload = {
  run_mode: string;
  rule_id: string;
  user_id: string;
  platform: string;
  timezone?: string;
  explicitness?: number;
  tones?: any;
  posts_per_day?: number;
  time_slots?: any;
  creator_pct?: number;
  platform_pct?: number;
};

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let payload: AutopostPayload;

  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "INVALID_JSON" });
  }

  if (payload.platform !== "onlyfans") {
    return json(400, { ok: false, error: "INVALID_PLATFORM" });
  }

  if (!payload.rule_id || !payload.user_id) {
    return json(400, { ok: false, error: "MISSING_REQUIRED_FIELDS" });
  }

  if (payload.run_mode !== "autopost") {
    return json(400, { ok: false, error: "INVALID_RUN_MODE" });
  }

  /*
    PRODUCTION PLATFORM ADAPTER — ONLYFANS

    At launch:
    - This endpoint is the authoritative handler for OnlyFans dispatch
    - It validates input
    - It returns an explicit execution receipt

    Future:
    - Replace body below with real OnlyFans API logic
    - Executor contract MUST remain unchanged
  */

  return json(200, {
    ok: true,
    platform_post_id: `onlyfans_${Date.now()}`,
  });
}
