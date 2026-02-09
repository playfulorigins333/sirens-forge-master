import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { parseGenerationRequest } from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------
 * Helper — Inject LoRA trigger token into prompt
 * ------------------------------------------------ */
function injectTriggerToken(prompt: string, token: string) {
  const trimmedPrompt = (prompt || "").trim();
  const trimmedToken = (token || "").trim();

  if (!trimmedToken) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedToken;

  const re = new RegExp(`(^|\\s)${trimmedToken}(\\s|$)`, "i");
  if (re.test(trimmedPrompt)) return trimmedPrompt;

  return `${trimmedToken} ${trimmedPrompt}`.trim();
}

export async function POST(req: Request) {
  try {
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
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    /* ------------------------------------------------
     * PARSE REQUEST
     * ------------------------------------------------ */
    const raw = await req.json();
    const request = parseGenerationRequest(raw);

    /* ------------------------------------------------
     * Inject trigger token if identity LoRA selected
     * ------------------------------------------------ */
    let finalPrompt = request.params.prompt;

    if (request.params.user_lora?.id) {
      const { data } = await supabase
        .from("user_loras")
        .select("trigger_token")
        .eq("id", request.params.user_lora.id)
        .single();

      if (data?.trigger_token) {
        finalPrompt = injectTriggerToken(finalPrompt, data.trigger_token);
      }
    }

    /* ------------------------------------------------
     * Resolve LoRA stack
     * ------------------------------------------------ */
    const loraStack = await resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    /* ------------------------------------------------
     * Build the REAL Comfy workflow graph
     * ------------------------------------------------ */
    const workflowGraph = buildWorkflow({
      prompt: finalPrompt,
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
     * 🚨 CRITICAL FIX — Wrap workflow for Railway gateway
     * ------------------------------------------------ */
    const payload = {
      workflow: {
        type: "sirens_generate_v1",
        engine: "comfyui",
        template: "sirens_image_v3_production",
        mode: "txt2img",
        inputs: {
          workflow_json: workflowGraph
        }
      }
    };

    const upstream = await fetch(`${RUNPOD_BASE_URL}/gateway/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "UPSTREAM_ERROR", status: upstream.status, body: text },
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
      { error: "INTERNAL_ERROR", message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
