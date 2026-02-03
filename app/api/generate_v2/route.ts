// app/api/generate_v2/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    // ✅ MUST await cookies()
    const cookieStore = await cookies();

    const supabase = createServerClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: "", ...options, maxAge: 0 });
          },
        },
      }
    );

    // 🔐 Validate session
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    // 📦 Parse payload
    const body = await req.json();

    if (!body || !body.prompt) {
      return NextResponse.json(
        { error: "Missing prompt" },
        { status: 400 }
      );
    }

    // ✅ HEALTH CHECK RESPONSE (for now)
    return NextResponse.json({
      ok: true,
      user_id: user.id,
      message: "generate_v2 authenticated and healthy",
      received: body,
    });
  } catch (err: any) {
    console.error("generate_v2 fatal:", err);

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        detail: err?.message ?? "unknown",
      },
      { status: 500 }
    );
  }
}
