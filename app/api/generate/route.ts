// app/api/generate/route.ts
// PHASE 4 — Add resolveLoraStack import (no execution)

import "server-only";

import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { parseGenerationRequest } from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver"; // 👈 NEW IN PHASE 4

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
// POST — AUTH ONLY (still no generation logic)
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
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
            // no-op
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
          phase: 4,
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
        phase: 4,
        message: "resolveLoraStack import did not break routing",
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
        phase: 4,
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
