export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/*
🚨 TEMP DEBUG BUILD 🚨
We are isolating the 405 error.

These imports are temporarily disabled because one of them
is crashing the route during module load, which prevents
NextJS from registering POST and causes 405 forever.
*/

// import { resolveLoraStack } from "@/lib/generation/lora-resolver";
// import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

function injectTriggerToken(prompt: string, token: string) {
  const trimmedPrompt = (prompt || "").trim();
  const trimmedToken = (token || "").trim();

  if (!trimmedToken) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedToken;

  const re = new RegExp(`(^|\\s)${trimmedToken}(\\s|$)`, "i");
  if (re.test(trimmedPrompt)) return trimmedPrompt;

  return `${trimmedToken} ${trimmedPrompt}`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;

    if (!RUNPOD_BASE_URL) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    // Server-safe Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

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
      return NextResponse.json(
        { error: "PROMPT_REQUIRED" },
        { status: 400 }
      );
    }

    let finalPrompt = prompt;

    // Fetch LoRA trigger token (public read allowed)
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

    /*
      🚨 TEMP: Stub workflow until route loads correctly
      Once 405 is gone we re-enable real workflow builder.
    */
    const workflowGraph = {
      debug: true,
      message: "Route is alive. Imports disabled.",
      inputs: {
        prompt: finalPrompt,
        negative_prompt,
        body_mode,
        width,
        height,
        steps,
        cfg,
        seed,
        identity_lora,
      },
    };

    const payload = {
      workflow: {
        type: "sirens_generate_v1",
        engine: "comfyui",
        template: "sirens_image_v3_production",
        mode: "txt2img",
        inputs: {
          workflow_json: workflowGraph,
        },
      },
    };

    const upstream = await fetch(`${RUNPOD_BASE_URL}/gateway/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
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
