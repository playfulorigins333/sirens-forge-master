import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { validateVaultIds, type Mode as VaultMode } from "@/prompts/nsfw_gpt/vault_registry";

export const runtime = "nodejs";

/**
 * Runtime-safe env access
 */
function getEnv(name: string): string | null {
  return process.env[name] ?? null;
}

/**
 * Load prompt bundle files
 */
function loadPrompt(file: string): string {
  const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", file);
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Load system layers (LOCKED)
 */
const SYSTEM_BASE = loadPrompt("nsfw_gpt.system.base.txt");
const ROUTER = loadPrompt("nsfw_gpt.router.system.txt");
const FUNNEL = loadPrompt("nsfw_gpt.conversation.funnel_governor.txt");
const OUTPUT_ENFORCER = loadPrompt("nsfw_gpt.output.generator_compat_enforcer.txt"); // ✅ correct name
const HEADLESS_CONTRACT = loadPrompt("nsfw_gpt.headless.contract_and_refusal.txt");
const HEADLESS_SYSTEM = loadPrompt("bundle.headless.system.txt");

/**
 * Output types (first-class)
 */
type OutputType = "IMAGE" | "VIDEO" | "STORY";

function normalizeOutputType(v: any): OutputType | null {
  const s = String(v || "").trim().toUpperCase();
  if (s === "IMAGE" || s === "VIDEO" || s === "STORY") return s;
  return null;
}

/**
 * Output-type router system layer (no UI changes; no execution)
 * - Locks a structural contract immediately after output selection.
 * - Produces structured JSON that downstream can route (generator/story builder).
 *
 * IMPORTANT: We still also return a legacy `prompt` string for drop-in compatibility.
 */
function buildOutputTypeSystem(outputType: OutputType): string {
  // Keep this deterministic, short, and contract-focused.
  if (outputType === "IMAGE") {
    return [
      "# OUTPUT TYPE ROUTER: IMAGE",
      "- The user is building an IMAGE prompt.",
      "- Return a SINGLE JSON object only (no markdown, no backticks).",
      "- JSON schema:",
      '  { "prompt": string, "negative_prompt": string, "tags": string[], "notes": string }',
      "- `prompt` must be generator-ready (SDXL style), one line is fine.",
      "- `negative_prompt` must be safe, anatomy-quality oriented.",
      "- `tags` are short keywords (no hashtags).",
      "- `notes` is brief: what was assumed/locked (style, POV, mood).",
    ].join("\n");
  }

  if (outputType === "VIDEO") {
    return [
      "# OUTPUT TYPE ROUTER: VIDEO",
      "- The user is building a VIDEO prompt/scene spec.",
      "- Return a SINGLE JSON object only (no markdown, no backticks).",
      "- JSON schema:",
      '  { "prompt": string, "negative_prompt": string, "motion": string, "camera": string, "tags": string[], "notes": string }',
      "- `prompt` must describe the scene clearly for image→video or text→video.",
      "- `motion` describes subject + environment motion (short).",
      "- `camera` describes camera movement + lens feel (short).",
      "- `negative_prompt` is quality/safety oriented.",
      "- `notes` brief: what was locked and any safe clarifications made.",
    ].join("\n");
  }

  // STORY
  return [
    "# OUTPUT TYPE ROUTER: STORY",
    "- The user is building a STORY / scene write-up.",
    "- Return a SINGLE JSON object only (no markdown, no backticks).",
    "- JSON schema:",
    '  { "title": string, "premise": string, "scene": string, "beats": string[], "tags": string[], "notes": string }',
    "- `scene` is the actual prose scene (concise, vivid).",
    "- `beats` are 5–10 bullet beats (strings).",
    "- Keep it consistent with the locked mode + vault stack guidance.",
  ].join("\n");
}

/**
 * Load a vault text file by id.
 * Convention: prompts/nsfw_gpt/vaults/<vault_id>.txt
 */
function loadVaultText(vaultId: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", "vaults", `${vaultId}.txt`);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Models by mode
 * NOTE: these are OpenAI-compatible provider model names; your OPENAI_COMPAT_* env vars control the actual gateway.
 */
const MODEL_BY_MODE: Record<VaultMode, string> = {
  SAFE: "openai/gpt-5-mini",
  NSFW: "openai/gpt-4o",
  ULTRA: "nousresearch/hermes-4-405b",
};

const REQUIRED_FIELDS = [
  "mode",
  "intent",
  "output_format",
  "dna_decision",
  "stack_depth",
  "description",
  "output_type", // ✅ NEW (LOCKED)
] as const;

type HeadlessBody = {
  mode: string;
  intent: string;
  output_format: string;
  dna_decision: string;
  stack_depth: string;
  description: string;

  // ✅ NEW (LOCKED)
  output_type: OutputType | string;

  // optional (v0)
  vault_ids?: string[]; // UI sends vault_ids
};

type HeadlessSuccess = {
  status: "ok";
  mode: VaultMode;
  model: string;
  output_type: OutputType;
  result: {
    /**
     * Legacy string prompt (kept for generator injection / compatibility).
     * For STORY, this will be derived from structured output when possible.
     */
    prompt: string;

    /**
     * Structured JSON (preferred downstream contract).
     * null if the provider returned non-JSON or parse failed.
     */
    structured: any | null;

    metadata: {
      output_type: OutputType;
      vault_ids: string[];
      invalid_vaults: string[];
      blocked_vaults: string[];
      missing_vault_files: string[];
      contract_parse: "ok" | "fallback_text";
    };
  };
};

type HeadlessError = {
  error: string;
  [k: string]: any;
};

function tryParseJsonObject(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;

  // Best-effort: some models may wrap JSON with leading/trailing whitespace.
  // We DO NOT strip markdown here to keep behavior deterministic.
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return null;
  }
}

function coerceLegacyPrompt(outputType: OutputType, structured: any | null, fallbackText: string): string {
  if (structured && typeof structured === "object") {
    // If structured has a prompt, use it.
    if (typeof structured.prompt === "string" && structured.prompt.trim()) return structured.prompt.trim();

    // STORY: derive a reasonable legacy string prompt from scene/title if present.
    if (outputType === "STORY") {
      const title = typeof structured.title === "string" ? structured.title.trim() : "";
      const premise = typeof structured.premise === "string" ? structured.premise.trim() : "";
      const scene = typeof structured.scene === "string" ? structured.scene.trim() : "";
      const bits = [title && `Title: ${title}`, premise && `Premise: ${premise}`, scene && `Scene: ${scene}`].filter(Boolean);
      if (bits.length) return bits.join("\n");
    }
  }

  return (fallbackText || "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as HeadlessBody | null;
    if (!body) {
      return NextResponse.json({ error: "INVALID_JSON" } satisfies HeadlessError, { status: 400 });
    }

    const missing = REQUIRED_FIELDS.filter((f) => !(body as any)[f]);
    if (missing.length > 0) {
      return NextResponse.json({ error: "MISSING_REQUIRED_FIELDS", missing } satisfies HeadlessError, { status: 400 });
    }

    const mode = String(body.mode).toUpperCase() as VaultMode;
    const model = MODEL_BY_MODE[mode];

    if (!model) {
      return NextResponse.json(
        { error: "INVALID_MODE", allowed: Object.keys(MODEL_BY_MODE) } satisfies HeadlessError,
        { status: 400 }
      );
    }

    const outputType = normalizeOutputType((body as any).output_type);
    if (!outputType) {
      return NextResponse.json(
        { error: "INVALID_OUTPUT_TYPE", allowed: ["IMAGE", "VIDEO", "STORY"] } satisfies HeadlessError,
        { status: 400 }
      );
    }

    const apiKey = getEnv("OPENAI_COMPAT_API_KEY");
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL");

    if (!apiKey || !baseUrl) {
      return NextResponse.json(
        { error: "SERVER_MISCONFIGURED", reason: "Missing OPENAI_COMPAT_API_KEY or OPENAI_COMPAT_BASE_URL" } satisfies HeadlessError,
        { status: 500 }
      );
    }

    // ✅ Vault validation (optional)
    const inputVaultIds = Array.isArray(body.vault_ids) ? body.vault_ids : [];
    const v = validateVaultIds(inputVaultIds, mode);
    const vaultIds: string[] = v.vault_ids;

    // ✅ Load vault texts (only for validated + allowed vaults)
    const vaultTexts: string[] = [];
    const missingVaultFiles: string[] = [];
    for (const id of vaultIds) {
      const txt = loadVaultText(id);
      if (txt && txt.trim().length > 0) vaultTexts.push(`--- VAULT:${id} ---\n${txt.trim()}`);
      else missingVaultFiles.push(id);
    }

    // ✅ OutputType router system layer (no UI)
    const OUTPUT_TYPE_SYSTEM = buildOutputTypeSystem(outputType);

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      FUNNEL,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      HEADLESS_SYSTEM,
      OUTPUT_TYPE_SYSTEM,
      ...(vaultTexts.length > 0 ? ["\n\n# VAULT STACK (APPLIED)\n" + vaultTexts.join("\n\n")] : []),
    ].join("\n\n");

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: mode === "SAFE" ? 0.6 : 0.85,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.description },
        ],
      }),
    });

    const raw = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "PROVIDER_ERROR",
          provider_status: response.status,
          model,
          raw,
        } satisfies HeadlessError,
        { status: response.status }
      );
    }

    const content: string = raw?.choices?.[0]?.message?.content?.trim?.() ?? "";
    const structured = tryParseJsonObject(content);

    const legacyPrompt = coerceLegacyPrompt(outputType, structured, content);

    const out: HeadlessSuccess = {
      status: "ok",
      mode,
      model,
      output_type: outputType,
      result: {
        prompt: legacyPrompt,
        structured: structured,
        metadata: {
          output_type: outputType,
          vault_ids: vaultIds,
          invalid_vaults: v.invalid_ids,
          blocked_vaults: v.blocked_ids,
          missing_vault_files: missingVaultFiles,
          contract_parse: structured ? "ok" : legacyPrompt ? "ok" : "fallback_text",
        },
      },
    };

    return NextResponse.json(out, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "UNHANDLED_EXCEPTION", message: err?.message } satisfies HeadlessError,
      { status: 500 }
    );
  }
}
