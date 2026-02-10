export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Static imports so Vercel bundles server code
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

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
  console.log("🔥 /api/generate HIT"); // ← CRITICAL DEBUG LOG

  try {
    const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;

    if (!RUNPOD_BASE_URL) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    // NEXT 16 cookies are async
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
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

    // Inject trigger token if identity LoRA selected
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

    const loraStack = await resolveLoraStack(body_mode, identity_lora ?? null);

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

    console.log("➡️ Calling Railway:", `${RUNPOD_BASE_URL}/gateway/generate`);

    // Abort after 4 minutes (prevents Vercel crash → fake 405)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);

    const upstream = await fetch(`${RUNPOD_BASE_URL}/gateway/generate`, {
      method: "POST",
      cache: "no-store",            // ⭐ REQUIRED ON VERCEL
      signal: controller.signal,    // ⭐ prevent silent timeout crash
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timeout);

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error("❌ Railway error:", text);
      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          body: text,
        },
        { status: upstream.status }
      );
    }

    console.log("✅ Railway success");

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("💥 generate fatal error:", err);

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
