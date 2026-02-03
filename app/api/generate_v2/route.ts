// app/api/generate_v2/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/generate_v2
 *
 * Minimal, production-safe proxy:
 * - No auth logic here (handled by middleware + layout)
 * - No cookie mutation
 * - No env access at module scope
 * - Always returns JSON
 */
export async function POST(req: NextRequest) {
  try {
    // Parse request body safely
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "INVALID_JSON" },
        { status: 400 }
      );
    }

    // Read env vars at RUNTIME, not build time
    const base = process.env.RUNPOD_BASE_URL;
    if (!base) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    const target = `${base.replace(/\/$/, "")}/gateway/generate`;

    // Forward request to FastAPI gateway
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Read upstream response safely
    const text = await upstream.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return NextResponse.json(
        {
          error: "UPSTREAM_INVALID_JSON",
          raw: text,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data, {
      status: upstream.status,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "UNHANDLED_EXCEPTION",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
