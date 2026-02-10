// ------------------------------------------------------------
// /app/api/status/route.ts
// FULL FILE — PRODUCTION STATUS POLLING (NGINX GATEWAY SAFE)
// ------------------------------------------------------------

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// IMPORTANT:
// This env var already points to /gateway
// Example: https://<pod>-3000.proxy.runpod.net/gateway
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

  // ✅ DO NOT add /gateway here
  // nginx already handled it
  const targetUrl = `${GATEWAY_BASE.replace(/\/$/, "")}/status/${encodeURIComponent(job_id)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      signal: controller.signal,
    });

    if (!res.ok) {
      return errJson("status_failed", 502, await res.text());
    }

    const data = await res.json();

    // Rewrite relative image URLs to absolute
    if (Array.isArray(data?.outputs)) {
      data.outputs = data.outputs.map((o: any) => {
        if (typeof o?.url === "string" && o.url.startsWith("/")) {
          return {
            ...o,
            url: `${GATEWAY_BASE.replace(/\/$/, "")}${o.url}`,
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
