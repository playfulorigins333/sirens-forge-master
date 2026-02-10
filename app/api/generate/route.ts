import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
     * AUTH (subscription gating)
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
     * READ FLAT PAYLOAD FROM FRONTEND
     * ------------------------------------------------ */
    const body = await req.json();

    const {
      prompt,
      negative_prompt,
      body_mode,
      width,
      height,
      steps,
      cfg,
      seed,
      identity_lora,
    } = body;

    if (!prompt) {
      return NextResponse.json({ error: "PROMPT_REQUIRED" }, { status: 400 });
    }

    /* ------------------------------------------------
     * Inject trigger token if identity LoRA selected
     * ------------------------------------------------ */
    let finalPrompt = prompt;

    if (identity_lora) {
      const { data } = await supabase
        .from("user_loras")
        .select("trigger_token")
        .eq("id", identity_lora)
        .single();

      if (data?.trigger_token) {
        finalPrompt = injectTriggerToken(finalPrompt, data.trigger_token);
      }
    }

    /* ------------------------------------------------
     * Resolve LoRA stack
     * ------------------------------------------------ */
    const loraStack = await resolveLoraStack(body_mode, identity_lora ?? null);

    /* ------------------------------------------------
     * Build Comfy workflow graph
     * ------------------------------------------------ */
    const workflowGraph = buildWorkflow({
      prompt: finalPrompt,
      negative: negative_prompt || "",
      seed: seed ?? 0,
      steps,
      cfg,
      width,
      height,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    /* ------------------------------------------------
     * 🚨 CRITICAL — SEND identity_lora TO RAILWAY
     * ------------------------------------------------ */
    const payload = {
      workflow: {
        type: "sirens_generate_v1",
        engine: "comfyui",
        template: "sirens_image_v3_production",
        mode: "txt2img",
        inputs: {
          identity_lora: identity_lora ?? null,   // ⭐ REQUIRED
          workflow_json: workflowGraph,
        },
      },
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
