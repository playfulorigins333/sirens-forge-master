import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { validateVaultIds, type Mode as VaultMode } from "@/prompts/nsfw_gpt/vault_registry";

export const runtime = "nodejs";

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */

type OutputType = "IMAGE" | "VIDEO" | "STORY";

type HeadlessBody = {
  mode: string;
  intent: string;
  output_format: string;
  dna_decision: string;
  stack_depth: string;
  description: string;

  output_type?: OutputType; // 🔒 NEW: first-class, inferred by UI
  vault_ids?: string[];
};

type HeadlessSuccess = {
  status: "ok";
  mode: VaultMode;
  output_type: OutputType;
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

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */

function getEnv(name: string): string | null {
  return process.env[name] ?? null;
}

function loadPrompt(file: string): string {
  const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", file);
  return fs.readFileSync(fullPath, "utf-8");
}

function loadVaultText(vaultId: string): string | null {
  try {
    const fullPath = path.join(
      process.cwd(),
      "prompts",
      "nsfw_gpt",
      "vaults",
      `${vaultId}.txt`
    );
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────
   System Layers (LOCKED)
────────────────────────────────────────────── */

const SYSTEM_BASE = loadPrompt("nsfw_gpt.system.base.txt");
const ROUTER = loadPrompt("nsfw_gpt.router.system.txt");
const FUNNEL = loadPrompt("nsfw_gpt.conversation.funnel_governor.txt");
const OUTPUT_ENFORCER = loadPrompt("nsfw_gpt.output.generator_compat_enforcer.txt");
const HEADLESS_CONTRACT = loadPrompt("nsfw_gpt.headless.contract_and_refusal.txt");
const HEADLESS_SYSTEM = loadPrompt("bundle.headless.system.txt");

/* ──────────────────────────────────────────────
   Output-Type Routers (NO EXECUTION)
────────────────────────────────────────────── */

function getOutputRouter(output: OutputType): string {
  switch (output) {
    case "IMAGE":
      return `
# OUTPUT ROUTER: IMAGE
You are constructing a high-precision IMAGE GENERATION PROMPT.
Do NOT describe video motion.
Do NOT write narrative prose.
Focus on visual composition, subject detail, camera language, lighting, and style.
`;
    case "VIDEO":
      return `
# OUTPUT ROUTER: VIDEO
You are constructing a CINEMATIC VIDEO SCENE PROMPT.
Include motion, temporal continuity, camera movement, pacing, and atmosphere.
Do NOT collapse into a single still frame.
`;
    case "STORY":
      return `
# OUTPUT ROUTER: STORY
You are writing an EROTIC NARRATIVE.
Use prose, pacing, emotional beats, and character perspective.
Do NOT format as a generation prompt.
`;
    default:
      return "";
  }
}

/* ──────────────────────────────────────────────
   Models by Mode
────────────────────────────────────────────── */

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
] as const;

/* ──────────────────────────────────────────────
   POST Handler
────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as HeadlessBody | null;
    if (!body) {
      return NextResponse.json({ error: "INVALID_JSON" } satisfies HeadlessError, { status: 400 });
    }

    const missing = REQUIRED_FIELDS.filter((f) => !(body as any)[f]);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "MISSING_REQUIRED_FIELDS", missing } satisfies HeadlessError,
        { status: 400 }
      );
    }

    /* ───────── Mode ───────── */

    const mode = String(body.mode).toUpperCase() as VaultMode;
    const model = MODEL_BY_MODE[mode];
    if (!model) {
      return NextResponse.json(
        { error: "INVALID_MODE", allowed: Object.keys(MODEL_BY_MODE) } satisfies HeadlessError,
        { status: 400 }
      );
    }

    /* ───────── Output Type ───────── */

    const output_type = String(body.output_type || "").toUpperCase() as OutputType;
    if (!["IMAGE", "VIDEO", "STORY"].includes(output_type)) {
      return NextResponse.json(
        {
          error: "INVALID_OUTPUT_TYPE",
          allowed: ["IMAGE", "VIDEO", "STORY"],
        } satisfies HeadlessError,
        { status: 400 }
      );
    }

    const outputRouter = getOutputRouter(output_type);

    /* ───────── Env ───────── */

    const apiKey = getEnv("OPENAI_COMPAT_API_KEY");
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL");
    if (!apiKey || !baseUrl) {
      return NextResponse.json(
        { error: "SERVER_MISCONFIGURED" } satisfies HeadlessError,
        { status: 500 }
      );
    }

    /* ───────── Vault Validation ───────── */

    const inputVaultIds = Array.isArray(body.vault_ids) ? body.vault_ids : [];
    const v = validateVaultIds(inputVaultIds, mode);

    const vaultTexts: string[] = [];
    const missingVaultFiles: string[] = [];

    for (const id of v.vault_ids) {
      const txt = loadVaultText(id);
      if (txt && txt.trim()) {
        vaultTexts.push(`--- VAULT:${id} ---\n${txt.trim()}`);
      } else {
        missingVaultFiles.push(id);
      }
    }

    /* ───────── System Prompt Assembly ───────── */

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      FUNNEL,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      HEADLESS_SYSTEM,
      outputRouter,
      ...(vaultTexts.length
        ? ["\n\n# VAULT STACK (APPLIED)\n" + vaultTexts.join("\n\n")]
        : []),
    ].join("\n\n");

    /* ───────── Provider Call ───────── */

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: mode === "SAFE" ? 0.6 : 0.85,
        max_tokens: 1400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.description },
        ],
      }),
    });

    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: "PROVIDER_ERROR", model, raw } satisfies HeadlessError,
        { status: response.status }
      );
    }

    const prompt = raw?.choices?.[0]?.message?.content?.trim?.() ?? "";

    const out: HeadlessSuccess = {
      status: "ok",
      mode,
      output_type,
      model,
      result: {
        prompt,
        metadata: {
          vault_ids: v.vault_ids,
          invalid_vaults: v.invalid_ids,
          blocked_vaults: v.blocked_ids,
          missing_vault_files: missingVaultFiles,
          contract_parse: prompt ? "ok" : "fallback_text",
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
