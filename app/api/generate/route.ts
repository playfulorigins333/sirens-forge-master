// app/api/generate/route.ts
// PHASE 2 — Single import isolation test

import "server-only";

// 👇 ONLY NEW LINE vs Phase 1
import { parseGenerationRequest } from "@/lib/generation/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST() {
  return new Response(
    JSON.stringify({
      ok: true,
      phase: 2,
      message: "Import test passed",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function GET() {
  return new Response(
    JSON.stringify({ ok: false, error: "method_not_allowed" }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }
  );
}
