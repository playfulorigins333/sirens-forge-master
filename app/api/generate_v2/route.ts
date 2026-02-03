// app/api/generate_v2/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNPOD_BASE = process.env.RUNPOD_BASE_URL;

if (!RUNPOD_BASE) {
  throw new Error("Missing RUNPOD_BASE_URL env var");
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    const targetUrl =
      RUNPOD_BASE.replace(/\/$/, "") + "/gateway/generate";

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return new NextResponse(
      typeof data === "string" ? data : JSON.stringify(data),
      {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err: any) {
    console.error("[generate_v2] fatal error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
