import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Runtime-safe env access (NO build-time crashes)
 */
function getEnv(name: string): string | null {
  return process.env[name] ?? null;
}

/**
 * Load prompt bundle files from disk
 */
function loadPrompt(file: string): string {
  const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", file);
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Load ALL required system layers (LOCKED)
 */
const SYSTEM_BASE = loadPrompt("nsfw_gpt.system.base.txt");
const ROUTER = loadPrompt("nsfw_gpt.router.system.txt");
const FUNNEL = loadPrompt("nsfw_gpt.conversation.funnel_governor.txt");
const OUTPUT_ENFORCER = loadPrompt("nsfw_gpt.output_generator_compat_enforcer.txt");
const HEADLESS_CONTRACT = loadPrompt("nsfw_gpt.headless.contract_and_refusal.txt");
const HEADLESS_SYSTEM = loadPrompt("bundle.headless.system.txt");

/**
 * ULTRA model (CONFIRMED VALID)
 */
const MODEL_BY_MODE: Record<string, string> = {
  SAFE: "openai/gpt-5-mini",
  NSFW: "openai/gpt-4o",
  ULTRA: "nousresearch/hermes-4-405b",
};

/**
 * Required fields for headless execution
 */
const REQUIRED_FIELDS = [
  "mode",
  "intent",
  "output_format",
  "dna_decision",
  "stack_depth",
  "description",
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // -----------------------------
    // Validate required fields
    // -----------------------------
    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "MISSING_REQUIRED_FIELDS",
          missing,
        },
        { status: 400 }
      );
    }

    const mode = String(body.mode).toUpperCase();
    const model = MODEL_BY_MODE[mode];

    if (!model) {
      return NextResponse.json(
        {
          error: "INVALID_MODE",
          allowed: Object.keys(MODEL_BY_MODE),
        },
        { status: 400 }
      );
    }

    // -----------------------------
    // Runtime env validation
    // -----------------------------
    const apiKey = getEnv("OPENAI_COMPAT_API_KEY");
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL");

    if (!apiKey || !baseUrl) {
      return NextResponse.json(
        {
          error: "SERVER_MISCONFIGURED",
          reason: "OPENAI_COMPAT_API_KEY or BASE_URL missing",
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // Assemble SYSTEM PROMPT (LOCKED ORDER)
    // -----------------------------
    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      FUNNEL,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      HEADLESS_SYSTEM,
    ].join("\n\n");

    // -----------------------------
    // OpenRouter request
    // -----------------------------
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: mode === "SAFE" ? 0.6 : 0.85,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: body.description,
          },
        ],
      }),
    });

    const raw = await response.json();

    // -----------------------------
    // Provider error passthrough (JSON ONLY)
    // -----------------------------
    if (!response.ok) {
      return NextResponse.json(
        {
          error: "PROVIDER_ERROR",
          provider_status: response.status,
          model,
          raw,
        },
        { status: response.status }
      );
    }

    const prompt =
      raw?.choices?.[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({
      status: "ok",
      mode,
      model,
      result: {
        prompt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "UNHANDLED_EXCEPTION",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
