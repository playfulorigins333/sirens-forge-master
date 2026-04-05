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
 * Load prompt bundle files
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
 * Output types (first-class)
 */
type OutputType = "IMAGE" | "VIDEO" | "STORY";

function normalizeOutputType(v: any): OutputType | null {
  const s = String(v || "").trim().toUpperCase();
  if (s === "IMAGE" || s === "VIDEO" || s === "STORY") return s;
  return null;
}

/**
 * Output-type router system layer
 */
function buildOutputTypeSystem(outputType: OutputType): string {
  if (outputType === "IMAGE") {
    return [
      "# OUTPUT TYPE ROUTER: IMAGE",
      "- Return JSON only",
      '{ "prompt": string, "negative_prompt": string, "tags": string[], "notes": string }',
    ].join("\n");
  }

  if (outputType === "VIDEO") {
    return [
      "# OUTPUT TYPE ROUTER: VIDEO",
      "- Return JSON only",
      '{ "prompt": string, "negative_prompt": string, "motion": string, "camera": string }',
    ].join("\n");
  }

  return [
    "# OUTPUT TYPE ROUTER: STORY",
    "- Return JSON only",
    '{ "title": string, "scene": string }',
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const mode = String(body.mode).toUpperCase() as VaultMode;
    const model = MODEL_BY_MODE[mode];

    const outputType = normalizeOutputType(body.output_type);

    const apiKey = getEnv("OPENAI_COMPAT_API_KEY");
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL");

    const v = validateVaultIds(body.vault_ids || [], mode);
    const m = validateMacroIds(body.macro_ids || [], mode);

    const vaultTexts = v.vault_ids
      .map((id) => loadVaultText(id))
      .filter(Boolean)
      .map((txt, i) => `--- VAULT:${v.vault_ids[i]} ---\n${txt}`);

    const macroTexts = m.macro_ids
      .map((id) => loadMacroText(id))
      .filter(Boolean)
      .map((txt, i) => `--- MACRO:${m.macro_ids[i]} ---\n${txt}`);

    const OUTPUT_TYPE_SYSTEM = buildOutputTypeSystem(outputType!);

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      OUTPUT_TYPE_SYSTEM,
      ...(vaultTexts.length ? ["# VAULT STACK\n" + vaultTexts.join("\n")] : []),
      ...(macroTexts.length ? ["# MACRO STACK\n" + macroTexts.join("\n")] : []),
    ].join("\n\n");

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.description },
        ],
      }),
    });

    const raw = await response.json();
    const content = raw?.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({
      status: "ok",
      prompt: content,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "UNKNOWN_ERROR" }, { status: 500 });
  }
}