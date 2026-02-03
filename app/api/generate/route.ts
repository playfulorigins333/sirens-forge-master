// app/api/generate/route.ts
// PHASE 1 — ROUTING CANARY (NO IMPORTS, NO LOGIC)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// REQUIRED: OPTIONS (preflight / method contract)
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

// REQUIRED: POST
export async function POST() {
  return new Response(
    JSON.stringify({
      ok: true,
      phase: 1,
      message: "POST /api/generate routing works",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Guard
export async function GET() {
  return new Response(
    JSON.stringify({ ok: false, error: "method_not_allowed" }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }
  );
}
