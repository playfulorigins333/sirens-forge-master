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

const REQUIRED_FIELDS = ["mode", "intent", "output_format", "dna_decision", "stack_depth", "description"] as const;

type HeadlessBody = {
  mode: string;
  intent: string;
  output_format: string;
  dna_decision: string;
  stack_depth: string;
  description: string;

  // optional (v0)
  vault_ids?: string[]; // ✅ UI sends vault_ids
};

type HeadlessSuccess = {
  status: "ok";
  mode: VaultMode;
  model: string;
  result: {
    prompt: string;
    metadata: {
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
      return NextResponse.json({ error: "INVALID_MODE", allowed: Object.keys(MODEL_BY_MODE) } satisfies HeadlessError, { status: 400 });
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

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      FUNNEL,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      HEADLESS_SYSTEM,
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

    const prompt = raw?.choices?.[0]?.message?.content?.trim?.() ?? "";

    const out: HeadlessSuccess = {
      status: "ok",
      mode,
      model,
      result: {
        prompt,
        metadata: {
          vault_ids: vaultIds,
          invalid_vaults: v.invalid_ids,
          blocked_vaults: v.blocked_ids,
          missing_vault_files: missingVaultFiles,
          contract_parse: prompt ? "ok" : "fallback_text",
        },
      },
    };

    return NextResponse.json(out, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "UNHANDLED_EXCEPTION", message: err?.message } satisfies HeadlessError, { status: 500 });
  }
}
