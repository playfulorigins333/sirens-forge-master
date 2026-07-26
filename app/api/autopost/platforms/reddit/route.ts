import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function POST(_request: Request) {
  return NextResponse.json(
    {
      ok: false,
      platform: "reddit",
      status: "NOT_CONFIGURED",
      error_code: "REDDIT_NATIVE_POSTING_NOT_CONFIGURED",
      error_message: "Reddit native posting is not configured. No provider request or post was attempted.",
      provider_request_attempted: false,
      post_attempted: false,
      retry_attempted: false,
      database_write_attempted: false,
      outcome_uncertain: false,
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export function GET() {
  return NextResponse.json(
    {
      ok: false,
      platform: "reddit",
      status: "METHOD_NOT_ALLOWED",
      error_code: "METHOD_NOT_ALLOWED",
      error_message: "POST only.",
      provider_request_attempted: false,
      post_attempted: false,
      retry_attempted: false,
      database_write_attempted: false,
      outcome_uncertain: false,
    },
    { status: 405, headers: NO_STORE_HEADERS },
  );
}
