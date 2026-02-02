// ------------------------------------------------------------
// /app/api/status/route.ts
// FULL FILE — PRODUCTION STATUS POLLING (COMFYUI GATEWAY)
// ------------------------------------------------------------

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// This must be the FastAPI gateway base (9100), NOT ComfyUI directly
const GATEWAY_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const TIMEOUT_MS = 30_000;

function errJson(error: string, status: number, detail?: string) {
  return NextResponse.json(
    { success: false, error, ...(detail ? { detail } : {}) },
    { status }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const job_id = url.searchParams.get("job_id");

  if (!GATEWAY_BASE) {
    return errJson("server_not_configured", 500);
  }

  if (!job_id) {
    return errJson("missing_job_id", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${GATEWAY_BASE}/status/${encodeURIComponent(job_id)}`,
      {
        method: "GET",
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return errJson("status_failed", 502, await res.text());
    }

    const data = await res.json();

    // IMPORTANT:
    // If gateway returns relative image URLs (e.g. /view?...),
    // rewrite them to absolute URLs so the browser can load them.
    if (Array.isArray(data?.outputs)) {
      data.outputs = data.outputs.map((o: any) => {
        if (typeof o?.url === "string" && o.url.startsWith("/")) {
          return {
            ...o,
            url: `${GATEWAY_BASE}${o.url}`,
          };
        }
        return o;
      });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return errJson("status_failed", 502, e?.message || "fetch failed");
  } finally {
    clearTimeout(timeout);
  }
}
