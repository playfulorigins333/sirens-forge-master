import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Headless NSFW GPT API
 * - JSON in
 * - JSON out
 * - No UI
 * - No persistence
 * - Prompts only
 */

const REQUIRED_FIELDS = [
  "mode",
  "intent",
  "output_format",
  "dna_decision",
  "stack_depth",
];

function loadHeadlessSystemPrompt(): string {
  const basePath = process.cwd();
  const promptPath = path.join(
    basePath,
    "prompts",
    "nsfw_gpt",
    "bundle.headless.system.txt"
  );

  return fs.readFileSync(promptPath, "utf8");
}

function validatePayload(payload: any): string[] {
  if (!payload || typeof payload !== "object") return REQUIRED_FIELDS;

  return REQUIRED_FIELDS.filter(
    (field) => payload[field] === undefined || payload[field] === null
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const missing = validatePayload(body);

    if (missing.length > 0) {
      return NextResponse.json(
        {
          status: "error",
          error_code: "MISSING_REQUIRED_FIELD",
          reason: `Missing required fields: ${missing.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Load headless system bundle (logic only)
    const systemPrompt = loadHeadlessSystemPrompt();

    /**
     * IMPORTANT:
     * We are NOT calling the model yet.
     * This route only validates + echoes structure.
     * Model invocation will be added AFTER this passes tests.
     */

    return NextResponse.json({
      status: "ok",
      mode: body.mode,
      intent: body.intent,
      output_format: body.output_format,
      system_loaded: true,
      note: "Headless NSFW GPT endpoint is live. Model execution not yet wired.",
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "error",
        error_code: "INVALID_REQUEST",
        reason: err?.message || "Malformed JSON payload",
      },
      { status: 400 }
    );
  }
}
