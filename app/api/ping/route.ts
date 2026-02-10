export async function GET() {
  return new Response(JSON.stringify({ ok: true, route: "ping" }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST() {
  return new Response(JSON.stringify({ ok: true, method: "post" }), {
    headers: { "Content-Type": "application/json" },
  });
}
