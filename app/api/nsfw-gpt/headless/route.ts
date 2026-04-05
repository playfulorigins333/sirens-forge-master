import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { validateVaultIds, type Mode as VaultMode } from "@/prompts/nsfw_gpt/vault_registry";
import { validateMacroIds } from "@/prompts/nsfw_gpt/macro_registry";

export const runtime = "nodejs";

/**
 * Runtime-safe env access
 */
function getEnv(name: string): string | null {
  return process.env[name] ?? null;
}

/**
 * Load prompt files
 */
function loadPrompt(file: string): string {
  const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", file);
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Load system layers (HEADLESS ONLY — CLEAN STACK)
 */
const SYSTEM_BASE = loadPrompt("nsfw_gpt.system.base.txt");
const ROUTER = loadPrompt("nsfw_gpt.router.system.txt");
const OUTPUT_ENFORCER = loadPrompt("nsfw_gpt.output.generator_compat_enforcer.txt");
const HEADLESS_CONTRACT = loadPrompt("nsfw_gpt.headless.contract_and_refusal.txt");

/**
 * Output types
 */
type OutputType = "IMAGE" | "VIDEO" | "STORY";

function normalizeOutputType(v: unknown): OutputType | null {
  const s = String(v || "").trim().toUpperCase();
  if (s === "IMAGE" || s === "VIDEO" || s === "STORY") return s;
  return null;
}

/**
 * Headless payload
 */
type HeadlessBody = {
  mode?: string;
  intent?: string;
  output_format?: string;
  dna_decision?: string;
  stack_depth?: string;
  description?: string;
  output_type?: OutputType | string;
  vault_ids?: string[];
  macro_ids?: string[];
};

type HeadlessSuccess = {
  status: "ok";
  mode: VaultMode;
  model: string;
  output_type: OutputType;
  prompt: string;
  structured: any | null;
  raw_text: string;
  metadata: {
    vault_ids: string[];
    invalid_vaults: string[];
    blocked_vaults: string[];
    missing_vault_files: string[];
    macro_ids: string[];
    invalid_macros: string[];
    blocked_macros: string[];
    missing_macro_files: string[];
    contract_parse: "ok" | "fallback_text";
  };
};

type HeadlessError = {
  error: string;
  [k: string]: any;
};

/**
 * Output-type router system layer
 */
function buildOutputTypeSystem(outputType: OutputType): string {
  if (outputType === "IMAGE") {
    return [
      "# OUTPUT TYPE ROUTER: IMAGE",
      "- Return a SINGLE JSON object only (no markdown, no backticks).",
      '- JSON schema: { "prompt": string, "negative_prompt": string, "tags": string[], "notes": string }',
      "- `prompt` must be a clean image-generation prompt.",
      "- `negative_prompt` should be concise and quality-focused.",
      "- `tags` should be short keyword strings.",
      "- `notes` should briefly state what was emphasized.",
    ].join("\n");
  }

  if (outputType === "VIDEO") {
    return [
      "# OUTPUT TYPE ROUTER: VIDEO",
      "- Return a SINGLE JSON object only (no markdown, no backticks).",
      '- JSON schema: { "prompt": string, "negative_prompt": string, "motion": string, "camera": string, "notes": string }',
      "- `prompt` must describe the visual scene clearly for video generation.",
      "- `motion` must describe subject/environment motion.",
      "- `camera` must describe camera movement or lens behavior.",
      "- `negative_prompt` should be concise and quality-focused.",
      "- `notes` should briefly state what was emphasized.",
    ].join("\n");
  }

  return [
    "# OUTPUT TYPE ROUTER: STORY",
    "- Return a SINGLE JSON object only (no markdown, no backticks).",
    '- JSON schema: { "title": string, "scene": string, "notes": string }',
    "- `scene` should contain the actual story/prose output.",
  ].join("\n");
}

/**
 * Vault loader
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
 * Macro loader
 */
function loadMacroText(macroId: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", "macros", `${macroId}.txt`);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Models by mode
 */
const MODEL_BY_MODE: Record<VaultMode, string> = {
  SAFE: "openai/gpt-5-mini",
  NSFW: "openai/gpt-4o",
  ULTRA: "nousresearch/hermes-4-405b",
};

function tryParseJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return null;
  }
}

function coercePromptFromStructured(outputType: OutputType, structured: any | null, rawText: string): string {
  if (structured && typeof structured === "object") {
    if (typeof structured.prompt === "string" && structured.prompt.trim()) {
      return structured.prompt.trim();
    }

    if (outputType === "STORY") {
      const title = typeof structured.title === "string" ? structured.title.trim() : "";
      const scene = typeof structured.scene === "string" ? structured.scene.trim() : "";
      const pieces = [title && `Title: ${title}`, scene].filter(Boolean);
      if (pieces.length > 0) return pieces.join("\n\n");
    }
  }

  return String(rawText || "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as HeadlessBody | null;

    if (!body) {
      return NextResponse.json(
        { error: "INVALID_JSON" } satisfies HeadlessError,
        { status: 400 }
      );
    }

    const description = String(body.description || "").trim();
    if (!description) {
      return NextResponse.json(
        { error: "MISSING_DESCRIPTION" } satisfies HeadlessError,
        { status: 400 }
      );
    }

    const mode = String(body.mode || "").toUpperCase() as VaultMode;
    const model = MODEL_BY_MODE[mode];

    if (!model) {
      return NextResponse.json(
        {
          error: "INVALID_MODE",
          allowed: Object.keys(MODEL_BY_MODE),
        } satisfies HeadlessError,
        { status: 400 }
      );
    }

    // IMPORTANT:
    // Default to IMAGE if caller does not supply output_type.
    // This prevents accidental fallthrough into STORY behavior.
    const outputType: OutputType = normalizeOutputType(body.output_type) ?? "IMAGE";

    const apiKey = getEnv("OPENAI_COMPAT_API_KEY");
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL");

    if (!apiKey || !baseUrl) {
      return NextResponse.json(
        {
          error: "SERVER_MISCONFIGURED",
          reason: "Missing OPENAI_COMPAT_API_KEY or OPENAI_COMPAT_BASE_URL",
        } satisfies HeadlessError,
        { status: 500 }
      );
    }

    const v = validateVaultIds(body.vault_ids || [], mode);
    const m = validateMacroIds(body.macro_ids || [], mode);

    const missingVaultFiles: string[] = [];
    const vaultTexts = v.vault_ids
      .map((id) => {
        const txt = loadVaultText(id);
        if (!txt) {
          missingVaultFiles.push(id);
          return null;
        }
        return `--- VAULT:${id} ---\n${txt}`;
      })
      .filter((x): x is string => Boolean(x));

    const missingMacroFiles: string[] = [];
    const macroTexts = m.macro_ids
      .map((id) => {
        const txt = loadMacroText(id);
        if (!txt) {
          missingMacroFiles.push(id);
          return null;
        }
        return `--- MACRO:${id} ---\n${txt}`;
      })
      .filter((x): x is string => Boolean(x));

    const OUTPUT_TYPE_SYSTEM = buildOutputTypeSystem(outputType);

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      OUTPUT_TYPE_SYSTEM,
      ...(vaultTexts.length ? ["# VAULT STACK\n" + vaultTexts.join("\n\n")] : []),
      ...(macroTexts.length ? ["# MACRO STACK\n" + macroTexts.join("\n\n")] : []),
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
          { role: "user", content: description },
        ],
      }),
    });

    const raw = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "PROVIDER_ERROR",
          provider_status: response.status,
          raw,
        } satisfies HeadlessError,
        { status: response.status }
      );
    }

    const rawText = String(raw?.choices?.[0]?.message?.content || "").trim();
    const structured = tryParseJsonObject(rawText);
    const prompt = coercePromptFromStructured(outputType, structured, rawText);

    const out: HeadlessSuccess = {
      status: "ok",
      mode,
      model,
      output_type: outputType,
      prompt,
      structured,
      raw_text: rawText,
      metadata: {
        vault_ids: v.vault_ids,
        invalid_vaults: v.invalid_ids,
        blocked_vaults: v.blocked_ids,
        missing_vault_files: missingVaultFiles,
        macro_ids: m.macro_ids,
        invalid_macros: m.invalid_ids,
        blocked_macros: m.blocked_ids,
        missing_macro_files: missingMacroFiles,
        contract_parse: structured ? "ok" : "fallback_text",
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