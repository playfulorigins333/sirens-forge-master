// app/api/generate/route.ts
// SHIM — forward to generate_v2 to bypass poisoned lambda

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();

  const res = await fetch(
    new URL("/api/generate_v2", req.url),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    }
  );

  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
