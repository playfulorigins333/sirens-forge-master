// app/api/generate_v2/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateRequest = {
  workflow: Record<string, any>;
  stream?: boolean;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export async function POST(req: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // 1️⃣ Parse + validate request body
    // ------------------------------------------------------------------
    let body: GenerateRequest;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 }
      );
    }

    if (!body.workflow || typeof body.workflow !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid `workflow`" },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 2️⃣ Build target FastAPI URL
    // ------------------------------------------------------------------
    const RUNPOD_BASE = mustEnv("RUNPOD_COMFY_WEBHOOK");
    const targetUrl = `${RUNPOD_BASE.replace(/\/$/, "")}/gateway/generate`;

    // ------------------------------------------------------------------
    // 3️⃣ Forward request to FastAPI gateway
    // ------------------------------------------------------------------
    const upstreamRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow: body.workflow,
        stream: Boolean(body.stream),
      }),
    });

    // ------------------------------------------------------------------
    // 4️⃣ Hard-fail if FastAPI errors
    // ------------------------------------------------------------------
    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      return NextResponse.json(
        {
          error: "FastAPI gateway error",
          status: upstreamRes.status,
          detail: text,
        },
        { status: 502 }
      );
    }

    const data = await upstreamRes.json();

    // ------------------------------------------------------------------
    // 5️⃣ Enforce contract: must return job_id
    // ------------------------------------------------------------------
    if (!data || typeof data.job_id !== "string") {
      return NextResponse.json(
        {
          error: "Invalid response from FastAPI",
          detail: data,
        },
        { status: 502 }
      );
    }

    // ------------------------------------------------------------------
    // 6️⃣ Success
    // ------------------------------------------------------------------
    return NextResponse.json(
      {
        job_id: data.job_id,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Unhandled generate_v2 error",
        message: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}

// Explicitly reject other methods (prevents ghost 200s)
export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405 }
  );
}
