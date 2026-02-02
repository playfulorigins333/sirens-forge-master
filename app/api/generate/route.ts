// FORCE REDEPLOY — TEMP SHORT-CIRCUIT FOR DEBUG
console.log("🔥 /api/generate route module loaded");

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ------------------------------------------------------------
// POST /api/generate
// TEMP: short-circuit to prove pipeline works
// ------------------------------------------------------------
export async function POST() {
  console.log("🟢 POST /api/generate SHORT-CIRCUIT HIT");

  return NextResponse.json({
    success: true,
    debug: true,
    message: "Short-circuit OK — API pipeline confirmed",
  });
}

// ------------------------------------------------------------
// OPTIONS /api/generate
// ------------------------------------------------------------
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
