import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  try {
    /* ---------------------------------------------
     * 1️⃣ ENV — do NOT crash build
     * --------------------------------------------- */
    const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;

    if (!RUNPOD_BASE_URL) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    /* ---------------------------------------------
     * 2️⃣ COOKIES (App Router SAFE)
     * --------------------------------------------- */
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    /* ---------------------------------------------
     * 3️⃣ REQUEST BODY
     * --------------------------------------------- */
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "INVALID_REQUEST_BODY" },
        { status: 400 }
      );
    }

    /* ---------------------------------------------
     * 4️⃣ FORWARD → FASTAPI
     * --------------------------------------------- */
    const targetUrl =
      RUNPOD_BASE_URL.replace(/\/$/, "") + "/gateway/generate";

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        user_id: user.id,
      }),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          body: text,
        },
        { status: upstream.status }
      );
    }

    /* ---------------------------------------------
     * 5️⃣ RETURN RESULT
     * --------------------------------------------- */
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    console.error("generate_v2 fatal error:", err);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
