import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import {
  validateVaultIds,
  type Mode as VaultMode,
} from "@/prompts/nsfw_gpt/vault_registry"
import { validateMacroIds } from "@/prompts/nsfw_gpt/macro_registry"

export const runtime = "nodejs"

/**
 * Runtime-safe env access
 */
function getEnv(name: string): string | null {
  return process.env[name] ?? null
}

/**
 * Load prompt files
 */
function loadPrompt(file: string): string {
  const fullPath = path.join(process.cwd(), "prompts", "nsfw_gpt", file)
  return fs.readFileSync(fullPath, "utf-8")
}

/**
 * Load system layers (HEADLESS ONLY — CLEAN STACK)
 */
const SYSTEM_BASE = loadPrompt("nsfw_gpt.system.base.txt")
const ROUTER = loadPrompt("nsfw_gpt.router.system.txt")
const OUTPUT_ENFORCER = loadPrompt(
  "nsfw_gpt.output.generator_compat_enforcer.txt"
)
const HEADLESS_CONTRACT = loadPrompt(
  "nsfw_gpt.headless.contract_and_refusal.txt"
)

/**
 * Output types
 */
type OutputType = "IMAGE" | "VIDEO" | "STORY"
type GenerationTarget = "text_to_image" | "text_to_video" | "image_to_video"

function normalizeOutputType(v: unknown): OutputType | null {
  const s = String(v || "")
    .trim()
    .toUpperCase()
  if (s === "IMAGE" || s === "VIDEO" || s === "STORY") return s
  return null
}

function normalizeGenerationTarget(v: unknown): GenerationTarget | null {
  const s = String(v || "")
    .trim()
    .toLowerCase()

  if (
    s === "text_to_image" ||
    s === "text-to-image" ||
    s === "text to image"
  ) {
    return "text_to_image"
  }

  if (
    s === "text_to_video" ||
    s === "text-to-video" ||
    s === "text to video"
  ) {
    return "text_to_video"
  }

  if (
    s === "image_to_video" ||
    s === "image-to-video" ||
    s === "image to video"
  ) {
    return "image_to_video"
  }

  return null
}

function outputTypeFromGenerationTarget(
  generationTarget: GenerationTarget | null
): OutputType | null {
  if (!generationTarget) return null
  if (generationTarget === "text_to_image") return "IMAGE"
  return "VIDEO"
}

type HistoryRole = "user" | "assistant"

type HistoryMessage = {
  role: HistoryRole
  content: string
}

/**
 * Headless payload
 */
type HeadlessBody = {
  mode?: string
  intent?: string
  output_format?: string
  dna_decision?: string
  stack_depth?: string
  description?: string
  output_type?: OutputType | string
  generation_target?: GenerationTarget | string
  vault_ids?: string[]
  macro_ids?: string[]
  history?: HistoryMessage[]
}

type HeadlessError = {
  error: string
  [k: string]: any
}

type HeadlessSuccess = {
  status: "ok"
  mode: VaultMode
  model: string
  output_type: OutputType
  generation_target: GenerationTarget | null
  prompt: string
  structured: any | null
  raw_text: string
  metadata: {
    generation_target: GenerationTarget | null
    vault_ids: string[]
    invalid_vaults: string[]
    blocked_vaults: string[]
    missing_vault_files: string[]
    macro_ids: string[]
    invalid_macros: string[]
    blocked_macros: string[]
    missing_macro_files: string[]
    contract_parse: "ok" | "fallback_text"
  }
}

/**
 * Output-type router system layer
 *
 * IMPORTANT:
 * - IMAGE returns plain prompt text only
 * - VIDEO returns structured JSON
 * - STORY returns structured JSON
 */
function buildOutputTypeSystem(outputType: OutputType): string {
  if (outputType === "IMAGE") {
    return [
      "# OUTPUT TYPE ROUTER: IMAGE",
      "- Return PLAIN TEXT ONLY.",
      "- Do NOT return JSON.",
      "- Do NOT wrap the result in an object.",
      "- Output a single clean generator-ready image prompt string.",
      "- No markdown, no backticks, no headings, no commentary.",
      "- If negative prompting is needed, keep the main prompt clean and prioritize the primary prompt text.",
    ].join("\n")
  }

  if (outputType === "VIDEO") {
    return [
      "# OUTPUT TYPE ROUTER: VIDEO",
      "- You MUST return a VALID JSON object only.",
      "- No text before or after JSON.",
      "- No markdown. No explanations. No prose outside the object.",
      '- JSON schema: { "prompt": string, "negative_prompt": string, "motion": string, "camera": string, "notes": string }',
      "- `prompt` must describe ONE short-form video scene only.",
      "- `prompt` must stay compact and production-ready for a 20–25 second clip.",
      "- `motion` must describe subject and environment motion in one short line.",
      "- `camera` must describe camera movement or lens behavior in one short line.",
      "- `negative_prompt` should be concise and quality-focused.",
      "- `notes` should briefly state what was emphasized.",
      "- Keep to a single subject, single environment, single emotional beat.",
      "- No screenplay formatting.",
      "- No dialogue blocks.",
      "- No multi-scene progression.",
      "- No long atmospheric paragraphs.",
      "- The JSON must be complete and valid.",
    ].join("\n")
  }

  return [
    "# OUTPUT TYPE ROUTER: STORY",
    "- Return a SINGLE JSON object only (no markdown, no backticks).",
    '- JSON schema: { "title": string, "scene": string, "notes": string }',
    "- `scene` should contain the actual story/prose output.",
  ].join("\n")
}

/**
 * Generation-target router system layer
 *
 * IMPORTANT:
 * - text_to_image => optimize for still-image generation
 * - text_to_video => optimize for short-form text-driven video
 * - image_to_video => optimize for continuity from a provided source image
 */
function buildGenerationTargetSystem(
  generationTarget: GenerationTarget | null
): string {
  if (!generationTarget) {
    return [
      "# GENERATION TARGET ROUTER: UNSPECIFIED",
      "- No explicit generation target was provided.",
      "- Follow the selected output type exactly.",
      "- Do not invent extra formats.",
      "- Keep the response generator-ready and concise.",
    ].join("\n")
  }

  if (generationTarget === "text_to_image") {
    return [
      "# GENERATION TARGET ROUTER: TEXT_TO_IMAGE",
      "- The user is creating for a still-image generation pipeline.",
      "- Optimize for a single-frame visual result.",
      "- Prioritize subject clarity, styling, composition, environment, lighting, mood, and rendering fidelity.",
      "- Do NOT describe time progression.",
      "- Do NOT describe camera movement.",
      "- Do NOT write as a screenplay or story beat list.",
      "- Keep the prompt clean, visual, and generator-ready.",
    ].join("\n")
  }

  if (generationTarget === "text_to_video") {
    return [
      "# GENERATION TARGET ROUTER: TEXT_TO_VIDEO",
      "- The user is creating for a text-to-video generation pipeline.",
      "- Optimize for one short-form video moment only.",
      "- Keep the scene compact, visually coherent, and easy to animate.",
      "- Emphasize one subject, one environment, one emotional beat.",
      "- Motion and camera should be simple, cinematic, and production-friendly.",
      "- Avoid multi-scene progression, long narrative arcs, and screenplay formatting.",
    ].join("\n")
  }

  return [
    "# GENERATION TARGET ROUTER: IMAGE_TO_VIDEO",
    "- The user is creating for an image-to-video generation pipeline.",
    "- Optimize for continuity from an already existing source image.",
    "- Preserve the core subject identity, styling, framing logic, wardrobe logic, and scene continuity unless the user explicitly asks for change.",
    "- Motion should feel natural, restrained, and compatible with a source still image.",
    "- Camera movement should be subtle, smooth, and production-friendly.",
    "- Avoid abrupt scene changes, new environments, or major subject redesign unless explicitly requested.",
    "- Keep the result compact and suitable for a short-form continuity-driven video clip.",
  ].join("\n")
}

/**
 * Vault loader
 */
function loadVaultText(vaultId: string): string | null {
  try {
    const fullPath = path.join(
      process.cwd(),
      "prompts",
      "nsfw_gpt",
      "vaults",
      `${vaultId}.txt`
    )
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, "utf-8")
  } catch {
    return null
  }
}

/**
 * Macro loader
 */
function loadMacroText(macroId: string): string | null {
  try {
    const fullPath = path.join(
      process.cwd(),
      "prompts",
      "nsfw_gpt",
      "macros",
      `${macroId}.txt`
    )
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, "utf-8")
  } catch {
    return null
  }
}

/**
 * Models by mode
 */
const MODEL_BY_MODE: Record<VaultMode, string> = {
  SAFE: "openai/gpt-5-mini",
  NSFW: "openai/gpt-4o",
  ULTRA: "nousresearch/hermes-4-405b",
}

function tryParseJsonObject(text: string): any | null {
  const raw = String(text || "").trim()
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed
    return null
  } catch {
    return null
  }
}

function coercePromptFromResponse(
  outputType: OutputType,
  structured: any | null,
  rawText: string
): string {
  const trimmed = String(rawText || "").trim()

  if (outputType === "IMAGE") {
    return trimmed
  }

  if (structured && typeof structured === "object") {
    if (typeof structured.prompt === "string" && structured.prompt.trim()) {
      if (outputType === "VIDEO") {
        const motion =
          typeof structured.motion === "string" ? structured.motion.trim() : ""
        const camera =
          typeof structured.camera === "string" ? structured.camera.trim() : ""

        const pieces = [
          structured.prompt.trim() && `Prompt: ${structured.prompt.trim()}`,
          motion && `Motion: ${motion}`,
          camera && `Camera: ${camera}`,
        ].filter(Boolean)

        if (pieces.length > 0) return pieces.join("\n")
      }

      return structured.prompt.trim()
    }

    if (outputType === "STORY") {
      const title =
        typeof structured.title === "string" ? structured.title.trim() : ""
      const scene =
        typeof structured.scene === "string" ? structured.scene.trim() : ""
      const pieces = [title && `Title: ${title}`, scene].filter(Boolean)
      if (pieces.length > 0) return pieces.join("\n\n")
    }

    if (outputType === "VIDEO") {
      const prompt =
        typeof structured.prompt === "string" ? structured.prompt.trim() : ""
      const motion =
        typeof structured.motion === "string" ? structured.motion.trim() : ""
      const camera =
        typeof structured.camera === "string" ? structured.camera.trim() : ""

      const pieces = [
        prompt && `Prompt: ${prompt}`,
        motion && `Motion: ${motion}`,
        camera && `Camera: ${camera}`,
      ].filter(Boolean)

      if (pieces.length > 0) return pieces.join("\n")
    }
  }

  return trimmed
}

function sanitizeHistory(history: unknown): HistoryMessage[] {
  if (!Array.isArray(history)) return []

  return history
    .filter((item): item is HistoryMessage => {
      if (!item || typeof item !== "object") return false
      const maybe = item as Partial<HistoryMessage>
      return (
        (maybe.role === "user" || maybe.role === "assistant") &&
        typeof maybe.content === "string" &&
        maybe.content.trim().length > 0
      )
    })
    .map((item) => ({
      role: item.role,
      content: item.content.trim(),
    }))
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as HeadlessBody | null

    if (!body) {
      return NextResponse.json(
        { error: "INVALID_JSON" } satisfies HeadlessError,
        { status: 400 }
      )
    }

    const description = String(body.description || "").trim()
    if (!description) {
      return NextResponse.json(
        { error: "MISSING_DESCRIPTION" } satisfies HeadlessError,
        { status: 400 }
      )
    }

    const mode = String(body.mode || "").toUpperCase() as VaultMode
    const model = MODEL_BY_MODE[mode]

    if (!model) {
      return NextResponse.json(
        {
          error: "INVALID_MODE",
          allowed: Object.keys(MODEL_BY_MODE),
        } satisfies HeadlessError,
        { status: 400 }
      )
    }

    const generationTarget = normalizeGenerationTarget(body.generation_target)

    const outputType: OutputType =
      outputTypeFromGenerationTarget(generationTarget) ??
      normalizeOutputType(body.output_type) ??
      "IMAGE"

    const apiKey = getEnv("OPENAI_COMPAT_API_KEY")
    const baseUrl = getEnv("OPENAI_COMPAT_BASE_URL")

    if (!apiKey || !baseUrl) {
      return NextResponse.json(
        {
          error: "SERVER_MISCONFIGURED",
          reason: "Missing OPENAI_COMPAT_API_KEY or OPENAI_COMPAT_BASE_URL",
        } satisfies HeadlessError,
        { status: 500 }
      )
    }

    const v = validateVaultIds(body.vault_ids || [], mode)
    const m = validateMacroIds(body.macro_ids || [], mode)

    const missingVaultFiles: string[] = []
    const vaultTexts = v.vault_ids
      .map((id) => {
        const txt = loadVaultText(id)
        if (!txt) {
          missingVaultFiles.push(id)
          return null
        }
        return `--- VAULT:${id} ---\n${txt}`
      })
      .filter((x): x is string => Boolean(x))

    const missingMacroFiles: string[] = []
    const macroTexts = m.macro_ids
      .map((id) => {
        const txt = loadMacroText(id)
        if (!txt) {
          missingMacroFiles.push(id)
          return null
        }
        return `--- MACRO:${id} ---\n${txt}`
      })
      .filter((x): x is string => Boolean(x))

    const OUTPUT_TYPE_SYSTEM = buildOutputTypeSystem(outputType)
    const GENERATION_TARGET_SYSTEM =
      buildGenerationTargetSystem(generationTarget)
    const history = sanitizeHistory(body.history)

    const systemPrompt = [
      SYSTEM_BASE,
      ROUTER,
      OUTPUT_ENFORCER,
      HEADLESS_CONTRACT,
      OUTPUT_TYPE_SYSTEM,
      GENERATION_TARGET_SYSTEM,
      ...(vaultTexts.length
        ? ["# VAULT STACK\n" + vaultTexts.join("\n\n")]
        : []),
      ...(macroTexts.length
        ? ["# MACRO STACK\n" + macroTexts.join("\n\n")]
        : []),
    ].join("\n\n")

    const messages: Array<{
      role: "system" | "user" | "assistant"
      content: string
    }> = [{ role: "system", content: systemPrompt }, ...history]

    const lastHistory = history[history.length - 1]
    if (
      !lastHistory ||
      lastHistory.role !== "user" ||
      lastHistory.content !== description
    ) {
      messages.push({ role: "user", content: description })
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: mode === "SAFE" ? 0.6 : 0.85,
        messages,
      }),
    })

    const raw = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "PROVIDER_ERROR",
          provider_status: response.status,
          raw,
        } satisfies HeadlessError,
        { status: response.status }
      )
    }

    const rawText = String(raw?.choices?.[0]?.message?.content || "").trim()

    const structured =
      outputType === "IMAGE" ? null : tryParseJsonObject(rawText)

    const prompt = coercePromptFromResponse(outputType, structured, rawText)

    const out: HeadlessSuccess = {
      status: "ok",
      mode,
      model,
      output_type: outputType,
      generation_target: generationTarget,
      prompt,
      structured,
      raw_text: rawText,
      metadata: {
        generation_target: generationTarget,
        vault_ids: v.vault_ids,
        invalid_vaults: v.invalid_ids,
        blocked_vaults: v.blocked_ids,
        missing_vault_files: missingVaultFiles,
        macro_ids: m.macro_ids,
        invalid_macros: m.invalid_ids,
        blocked_macros: m.blocked_ids,
        missing_macro_files: missingMacroFiles,
        contract_parse:
          outputType === "IMAGE"
            ? "ok"
            : structured
            ? "ok"
            : "fallback_text",
      },
    }

    return NextResponse.json(out, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "UNHANDLED_EXCEPTION",
        message: err?.message,
      } satisfies HeadlessError,
      { status: 500 }
    )
  }
}