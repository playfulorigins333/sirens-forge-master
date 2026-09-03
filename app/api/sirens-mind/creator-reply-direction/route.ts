import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"
import { ensureActiveSubscription } from "../../../../lib/subscription-checker"
import { consumeProviderSse } from "../../../../lib/sirens-mind/admin-rp"
import { buildCreatorReplyAuthoritySources, creatorReplyAccessAllowed, resolveCreatorReplyModel, validCreatorReplyThreadId, CREATOR_REPLY_STREAM_TIMEOUT_MS } from "../../../../lib/sirens-mind/creator-reply"
import { loadCreatorReplyAuthority, saveCreatorReplyCheckpoint } from "../../../../lib/sirens-mind/creator-reply-service"
import { trimCreatorReplyTurns } from "../../../../lib/sirens-mind/creator-reply-checkpoint"
import { validateCreatorReplyCandidate } from "../../../../lib/sirens-mind/creator-reply-validator"
import { buildCreatorReplyMessages, CREATOR_REPLY_TEMPERATURE } from "../../../../lib/sirens-mind/chat-construction"

export const runtime = "nodejs"
export const maxDuration = 300

const MAX_MESSAGE_CHARS = 8000
const MAX_PROVIDER_OUTPUT_TOKENS = 2000
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
type Mode = "SAFE" | "NSFW" | "ULTRA"
const MODES = new Set<Mode>(["SAFE", "NSFW", "ULTRA"])
const DEFAULT_MODELS: Record<Mode, string> = {
  SAFE: "openai/gpt-5-mini",
  NSFW: "openai/gpt-4o",
  ULTRA: "nousresearch/hermes-4-405b",
}

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` }
function promptFile(file: string) { return fs.readFileSync(path.join(process.cwd(), "prompts", "nsfw_gpt", file), "utf8") }
function telemetry(fields: Record<string, unknown>) {
  try { console.info(JSON.stringify({ event: "sirens_mind_turn", schemaVersion: 1, ...fields })) } catch { /* telemetry cannot affect responses */ }
}
function invalidText(value: unknown) {
  return typeof value !== "string" || !value.trim() || value.length > MAX_MESSAGE_CHARS || CONTROL_CHARACTERS.test(value)
}

export async function POST(req: NextRequest) {
  const auth = await ensureActiveSubscription()
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "INTERNAL_ERROR", message: auth.message }, { status: auth.status ?? 500 })
  if (!auth.user?.id) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const mode = body?.mode as Mode
  if (!body || !MODES.has(mode) || invalidText(body.message) || !validCreatorReplyThreadId(body.subscriber_id) || !validCreatorReplyThreadId(body.conversation_id)) {
    return NextResponse.json({ error: "INVALID_CREATOR_REPLY_DIRECTION" }, { status: 400 })
  }
  if (!creatorReplyAccessAllowed(auth.user.id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

  let authority: Awaited<ReturnType<typeof loadCreatorReplyAuthority>>
  try { authority = await loadCreatorReplyAuthority(auth.user.id, body.subscriber_id as string, body.conversation_id as string) }
  catch { return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) }

  const turns = authority.checkpoint.recent_turns
  if (turns.length < 2 || turns.at(-1)?.role !== "creator") {
    return NextResponse.json({ error: "CREATOR_REPLY_DIRECTION_REQUIRES_DRAFT" }, { status: 409 })
  }
  const latestSubscriber = [...turns].reverse().find((turn) => turn.role === "subscriber")
  if (!latestSubscriber) return NextResponse.json({ error: "CREATOR_REPLY_DIRECTION_REQUIRES_DRAFT" }, { status: 409 })

  const apiKey = process.env.OPENAI_COMPAT_API_KEY
  const baseUrl = process.env.OPENAI_COMPAT_BASE_URL
  if (!apiKey || !baseUrl) return NextResponse.json({ error: "PROMPT_ENGINE_UNAVAILABLE" }, { status: 503 })

  const direction = (body.message as string).trim()
  const generalModel = process.env[`SIRENS_MIND_${mode}_MODEL`] || DEFAULT_MODELS[mode]
  const model = resolveCreatorReplyModel(mode, generalModel)
  const authoritativeSources = buildCreatorReplyAuthoritySources({
    subscriber: authority.subscriber,
    continuity: authority.checkpoint.continuity,
    recentTurns: turns,
    inbound: latestSubscriber.text,
  }).filter((source) => source.id !== "current.inbound")
  const messages = buildCreatorReplyMessages({
    mode,
    systemPrompt: promptFile("nsfw_gpt.creator_reply.system.txt"),
    subscriber: authority.subscriber,
    continuity: authority.checkpoint.continuity,
    recentTurns: turns,
    inbound: latestSubscriber.text,
    direction,
    authoritySources: authoritativeSources,
  })

  const started = Date.now()
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  const abort = () => controller.abort()
  req.signal.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(abort, CREATOR_REPLY_STREAM_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, max_tokens: MAX_PROVIDER_OUTPUT_TOKENS, temperature: CREATOR_REPLY_TEMPERATURE, stream: true, stream_options: { include_usage: true }, messages }),
    })
  } catch (error) {
    clearTimeout(timeout)
    req.signal.removeEventListener("abort", abort)
    const timedOut = error instanceof Error && error.name === "AbortError"
    telemetry({ requestId, interactionClass: "creator_reply_direction", mode, model, temperature: CREATOR_REPLY_TEMPERATURE, ok: false, code: timedOut ? "PROMPT_ENGINE_TIMEOUT" : "PROMPT_ENGINE_UNAVAILABLE", validationOutcome: "NOT_RUN", continuityOutcome: "UNCHANGED", historyCount: turns.length, providerUsageAvailable: false, durationMs: Date.now() - started })
    return NextResponse.json({ error: timedOut ? "PROMPT_ENGINE_TIMEOUT" : "PROMPT_ENGINE_UNAVAILABLE" }, { status: timedOut ? 504 : 502 })
  }
  if (!response.ok || !response.body) {
    clearTimeout(timeout)
    req.signal.removeEventListener("abort", abort)
    return NextResponse.json({ error: "PROMPT_ENGINE_UNAVAILABLE" }, { status: 502 })
  }

  const encoder = new TextEncoder()
  let visible = ""
  let firstTokenMs: number | null = null
  const stream = new ReadableStream<Uint8Array>({
    async start(target) {
      let ok = false, code = "OK", usage: any = null, validationOutcome = "NOT_RUN", checkpointOutcome = "NOT_SAVED"
      try {
        const result = await consumeProviderSse(response.body!, (text) => {
          if (!text) return
          if (firstTokenMs === null) firstTokenMs = Date.now() - started
          visible += text
        })
        usage = result.usage
        const validation = validateCreatorReplyCandidate(visible, result.metadata, authoritativeSources)
        validationOutcome = validation.code
        if (!validation.ok) {
          code = "CREATOR_REPLY_GROUNDING_REJECTED"
          target.enqueue(encoder.encode(sse("error", { error: code })))
          return
        }
        visible = validation.text
        const revisedTurns = [...turns]
        revisedTurns[revisedTurns.length - 1] = { role: "creator", text: visible }
        const updated = {
          ...authority.checkpoint,
          continuity: authority.checkpoint.continuity,
          recent_turns: trimCreatorReplyTurns(revisedTurns),
        }
        target.enqueue(encoder.encode(sse("delta", { text: visible })))
        try {
          await saveCreatorReplyCheckpoint(auth.user!.id, authority, updated)
          checkpointOutcome = "SAVED"
          target.enqueue(encoder.encode(sse("memory_status", { saved: true })))
          ok = true
        } catch (error) {
          code = error instanceof Error && error.message === "CHECKPOINT_CONFLICT" ? "CHECKPOINT_CONFLICT" : "CHECKPOINT_SAVE_FAILED"
          checkpointOutcome = code
          target.enqueue(encoder.encode(sse("memory_status", { saved: false, conflict: code === "CHECKPOINT_CONFLICT" })))
        }
        target.enqueue(encoder.encode(sse("done", { checkpoint_saved: ok })))
      } catch {
        code = "PROMPT_ENGINE_STREAM_ERROR"
        target.enqueue(encoder.encode(sse("error", { error: "CREATOR_REPLY_UNAVAILABLE" })))
      } finally {
        clearTimeout(timeout)
        req.signal.removeEventListener("abort", abort)
        telemetry({ requestId, interactionClass: "creator_reply_direction", mode, model, temperature: CREATOR_REPLY_TEMPERATURE, ok, code, validationOutcome, continuityOutcome: "UNCHANGED", checkpointOutcome, historyCount: turns.length, outputChars: ok ? visible.length : 0, providerPromptTokens: usage?.prompt_tokens ?? null, providerCompletionTokens: usage?.completion_tokens ?? null, providerTotalTokens: usage?.total_tokens ?? null, providerUsageAvailable: Boolean(usage), durationMs: Date.now() - started, firstTokenMs })
        target.close()
      }
    },
    cancel() { abort() },
  })

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })
}
