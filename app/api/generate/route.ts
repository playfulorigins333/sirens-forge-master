// app/api/generate/route.ts
// FINAL CANARY — zero imports, POST only

export const runtime = "nodejs";

export async function POST() {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "POST /api/generate reached",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
