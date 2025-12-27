import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FanvuePayload = {
  run_mode: "autopost";
  rule_id: string;
  user_id: string;
  platform: "fanvue";
  timezone: string;
  explicitness: number;
  tones: any[];
  posts_per_day: number;
  time_slots: any[];
  creator_pct: number;
  platform_pct: number;
};

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as FanvuePayload | null;

    if (!body) {
      return json(400, { ok: false, error: "INVALID_JSON" });
    }

    if (
      body.run_mode !== "autopost" ||
      body.platform !== "fanvue" ||
      !body.rule_id ||
      !body.user_id
    ) {
      return json(400, { ok: false, error: "INVALID_PAYLOAD" });
    }

    return json(200, {
      ok: true,
      platform_post_id: `fanvue_${body.rule_id}_${Date.now()}`,
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "FANVUE_ADAPTER_EXCEPTION",
      message: err?.message ?? "Unhandled error",
    });
  }
}
