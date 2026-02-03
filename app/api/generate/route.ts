// app/api/generate/route.ts
// PHASE 3 — Auth-only isolation test

import "server-only";

import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { parseGenerationRequest } from "@/lib/generation/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// OPTIONS
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// POST — AUTH ONLY
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // Body parse (ensures req.json() is safe here)
    await req.json();

    const store = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return store.getAll().map((c) => ({
              name: c.name,
              value: c.value,
            }));
          },
          setAll() {
            // no-op for this phase
          },
        },
      }
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return new Response(
        JSON.stringify({
          ok: false,
          phase: 3,
          error: "not_authenticated",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        phase: 3,
        user_id: user.id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        phase: 3,
        error: err?.message || "unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// ------------------------------------------------------------
// GET GUARD
// ------------------------------------------------------------
export async function GET() {
  return new Response(
    JSON.stringify({ ok: false, error: "method_not_allowed" }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }
  );
}
