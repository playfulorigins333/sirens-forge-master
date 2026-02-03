import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { parseGenerationRequest } from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    /* ------------------------------------------------
     * ENV
     * ------------------------------------------------ */
    const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;

    if (!RUNPOD_BASE_URL) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    /* ------------------------------------------------
     * AUTH
     * ------------------------------------------------ */
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

    /* ------------------------------------------------
     * PARSE REQUEST (SAFE)
     * ------------------------------------------------ */
    const raw = await req.json();

    let request;
    try {
      request = parseGenerationRequest(raw);
    } catch (err: any) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST",
          message: err?.message ?? "Invalid generation payload",
        },
        { status: 400 }
      );
    }

    /* ------------------------------------------------
     * RESOLVE LORAS
     * ------------------------------------------------ */
    const loraStack = await resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    /* ------------------------------------------------
     * BUILD WORKFLOW
     * ------------------------------------------------ */
    const workflow = buildWorkflow({
      prompt: request.params.prompt,
      negative: request.params.negative_prompt || "",
      seed: request.params.seed ?? 0,
      steps: request.params.steps,
      cfg: request.params.cfg,
      width: request.params.width,
      height: request.params.height,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    /* ------------------------------------------------
     * FORWARD TO FASTAPI
     * ------------------------------------------------ */
    const targetUrl = `${RUNPOD_BASE_URL}/gateway/generate`;

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow,
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

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate fatal error:", err);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
