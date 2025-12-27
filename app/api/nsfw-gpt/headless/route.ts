import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_KEY = process.env.OPENAI_COMPAT_API_KEY;
const OPENROUTER_BASE_URL =
  process.env.OPENAI_COMPAT_BASE_URL || "https://openrouter.ai/api/v1";

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENAI_COMPAT_API_KEY is missing");
}

type Mode = "SAFE" | "NSFW" | "ULTRA";

const MODEL_BY_MODE: Record<Mode, string> = {
  SAFE: "meta-llama/llama-3.3-70b-instruct",
  NSFW: "mistralai/mistral-large-2411",
  ULTRA: "nousresearch/hermes-4-405b",
};

const SYSTEM_PROMPT_BY_MODE: Record<Mode, string> = {
  SAFE: `
You generate PG-13 prompts only.
Return prompt text only.
Do not include introductions, explanations, labels, or markdown.
Do not preface the output in any way.
`.trim(),

  NSFW: `
You generate explicit but consensual adult PROMPTS for AI image or video generation.
Return prompt text only.
Do not include introductions, explanations, labels, or markdown.
Do not preface the output in any way.
`.trim(),

  ULTRA: `
You generate long-form, extremely explicit, uncensored PROMPTS for AI image or video generation.

ABSOLUTE RULES:
- Return prompt text only.
- Do NOT include introductions (e.g., “Here is…”, “This prompt…”, etc.).
- Do NOT include explanations, labels, headings, or markdown.
- Do NOT roleplay or write dialogue.
- Do NOT reference yourself or the act of generating.
- Output must be a single continuous block of prompt text suitable for direct injection.

If you add any meta text, it will be considered an error.
`.trim(),
};

// Removes common meta lead-ins deterministically
function stripMetaPreface(text: string): string {
  return text
    .replace(
      /^(here is|here's|this is|below is|the following is)[\s\S]*?:\s*/i,
      ""
    )
    .replace(/^\s*(prompt|description)\s*:\s*/i, "")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, intent, output_format, stack_depth, description } = body ?? {};

    if (!mode || !intent || !output_format || !stack_depth) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", reason: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!["SAFE", "NSFW", "ULTRA"].includes(mode)) {
      return NextResponse.json(
        { error: "INVALID_MODE", reason: "Mode must be SAFE, NSFW, or ULTRA" },
        { status: 400 }
      );
    }

    const selectedModel = MODEL_BY_MODE[mode as Mode];
    const systemPrompt = SYSTEM_PROMPT_BY_MODE[mode as Mode];

    const payload = {
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: description || "" },
      ],
      temperature: mode === "SAFE" ? 0.7 : mode === "NSFW" ? 0.9 : 1.15,
      max_tokens: mode === "ULTRA" ? 1200 : 800,
    };

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "PROVIDER_ERROR",
          provider_status: response.status,
          model: selectedModel,
          raw: data,
        },
        { status: response.status }
      );
    }

    const rawText = data?.choices?.[0]?.message?.content || "";
    const promptText = stripMetaPreface(rawText);

    return NextResponse.json({
      status: "ok",
      mode,
      model: selectedModel,
      result: { prompt: promptText },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", reason: err?.message || "Unhandled error" },
      { status: 500 }
    );
  }
}
