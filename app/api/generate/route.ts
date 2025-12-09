// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status ?? 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "SirensForge /api/generate is live and subscription-gated.",
  });
}

export async function POST(req: Request) {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status ?? 401 }
    );
  }

  // Here is where RunPod/ComfyUI integration will go later.
  return NextResponse.json(
    {
      ok: true,
      message:
        "Generation backend not wired yet, but subscription gate is enforced.",
    },
    { status: 501 }
  );
}
