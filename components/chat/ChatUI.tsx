"use client"

import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { buildBoundedChatHistory } from "../../lib/sirens-mind/chat-history"
import { createTextBatcher } from "../../lib/sirens-mind/stream-batcher"

type Role = "user" | "assistant"

type Message = {
  id: string
  role: Role
  content: string
  isError?: boolean
  completed?: boolean
  meta?: {
    generationTarget?: GenerationTarget
    outputType?: OutputType
    negativePrompt?: string
    prompt?: string
    identityId?: string | null
    canUseInGenerator?: boolean
  }
}

type ConversationHandoff = {
  prompt: string
  negative_prompt: string | null
  output_type: "IMAGE" | "VIDEO"
  generation_target: GenerationTarget
  identity_id: string | null
}

type ConversationResponse = {
  status: "ok"
  reply: string
  handoff: ConversationHandoff | null
}

type ChatErrorResponse = {
  error: string
  message?: string
}

type GenerationTarget = "text_to_image" | "text_to_video" | "image_to_video"
type OutputType = "IMAGE" | "VIDEO"

type ChatUIProps = {
  experience?: "general" | "creator_reply"
  initialGenerationTarget?: GenerationTarget | null
  initialPrompt?: string | null
  initialNegativePrompt?: string | null
  initialIdentity?: string | null
  initialSourceGenerationAssetId?: string | null
}

const DEFAULT_NEGATIVE_PROMPT =
  "cartoon, 3d, render, low res, low resolution, blurry, poor quality, jpeg artifacts, cgi, bad anatomy, deformed, extra fingers, extra limbs"

const SIREN_MIND_HANDOFF_STORAGE_KEY = "sirensforge:siren_mind_handoff"
const SIREN_MIND_CONTINUITY_STORAGE_KEY = "sirensforge:sirens_mind_internal_continuity"

export default function ChatUI({
  experience = "general",
  initialGenerationTarget = null,
  initialPrompt = null,
  initialNegativePrompt = null,
  initialIdentity = null,
  initialSourceGenerationAssetId = null,
}: ChatUIProps) {
  const creatorReply = experience === "creator_reply"
  const [messages, setMessages] = useState<Message[]>(() => initialPrompt ? [{
    id: "generator-context", role: "user", content: `Current prompt to refine:\n${initialPrompt}`,
  }] : [])
  const [isTyping, setIsTyping] = useState(false)
  const [requestActive, setRequestActive] = useState(false)
  const [mode, setMode] = useState<"SAFE" | "NSFW" | "ULTRA">(creatorReply ? "ULTRA" : "SAFE")
  const [threadId, setThreadId] = useState("")
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const activeStreamBatcherRef = useRef<{ dispose: () => void } | null>(null)
  useEffect(() => () => { activeStreamBatcherRef.current?.dispose() }, [])
  useEffect(() => {
    if (!creatorReply) return
    try {
      const stored = window.sessionStorage.getItem("sirensforge:sirens_mind_creator_reply_thread")
      if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) setThreadId(stored)
      else { const next = crypto.randomUUID(); window.sessionStorage.setItem("sirensforge:sirens_mind_creator_reply_thread", next); setThreadId(next) }
    } catch { setThreadId(crypto.randomUUID()) }
  }, [creatorReply])
  useEffect(() => {
    if (messages.length === 0 && !isTyping) return

    const id = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      })
    }, 80)

    return () => window.clearTimeout(id)
  }, [messages, isTyping])

  const appendMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg])
  }

  const handleUsePrompt = (msg: Message) => {
    if (!msg.meta?.canUseInGenerator) return

    const handoffPayload = {
      prompt: msg.meta.prompt || msg.content,
      negative_prompt: msg.meta.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
      output_type: msg.meta.outputType || "IMAGE",
      generation_target: msg.meta.generationTarget || "text_to_image",
      identity: msg.meta.identityId || undefined,
      ...(msg.meta.generationTarget === "image_to_video" && initialSourceGenerationAssetId
        ? { source_generation_asset_id: initialSourceGenerationAssetId }
        : {}),
      created_at: Date.now(),
    }

    try {
      window.sessionStorage.setItem(
        SIREN_MIND_HANDOFF_STORAGE_KEY,
        JSON.stringify(handoffPayload),
      )
    } catch (err) {
      console.error("Failed to store Siren's Mind handoff:", err)
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I couldn't securely transfer this prompt to Generator. Your completed result is still here; please try again.",
        isError: true,
      })
      return
    }

    window.location.assign("/generate")
  }

  const sendChatRequest = async ({
    message,
    historyItems,
    selectedMode,
  }: {
    message: string
    historyItems: Message[]
    selectedMode: "SAFE" | "NSFW" | "ULTRA"
  }) => {
    let continuity: unknown
    const continuityKey = creatorReply ? `sirensforge:sirens_mind_creator_reply_continuity:${threadId}` : SIREN_MIND_CONTINUITY_STORAGE_KEY
    try { const stored = window.sessionStorage.getItem(continuityKey); continuity = stored ? JSON.parse(stored) : undefined } catch { continuity = undefined }
    const res = await fetch("/api/sirens-mind/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: selectedMode,
        experience,
        ...(creatorReply ? { thread_id: threadId } : {}),
        message,
        history: buildBoundedChatHistory(historyItems),
        context: {
          ...(initialGenerationTarget ? { generation_target: initialGenerationTarget } : {}),
          ...(initialPrompt ? { prompt: initialPrompt } : {}),
          ...(initialNegativePrompt ? { negative_prompt: initialNegativePrompt } : {}),
          ...(initialIdentity ? { identity_id: initialIdentity } : {}),
        },
        ...(continuity ? creatorReply ? { creator_reply_continuity: continuity } : { continuity } : {}),
      }),
    })
    if (res.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      if (!res.ok || !res.body) throw new Error("SIRENS_MIND_STREAM_UNAVAILABLE")
      const assistantId = crypto.randomUUID()
      appendMessage({ id: assistantId, role: "assistant", content: "" })
      const batcher = createTextBatcher(
        (text) => setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + text } : item)),
        (flush) => window.setTimeout(flush, 40),
        (handle) => window.clearTimeout(handle as number),
      )
      activeStreamBatcherRef.current = batcher
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = "", handoff: ConversationHandoff | null = null
      const applyEvent = (record: string) => {
        let event = "message", data = ""
        for (const line of record.split(/\r?\n/)) { if (line.startsWith("event:")) event = line.slice(6).trim(); else if (line.startsWith("data:")) data += line.slice(5).trimStart() }
        if (!data) return
        const payload = JSON.parse(data)
        if (event === "delta" && typeof payload?.text === "string") { if (payload.text) setIsTyping(false); batcher.append(payload.text) }
        else if (event === "done") {
          batcher.flush()
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, completed: true } : item))
        }
        else if (event === "handoff") { batcher.flush(); handoff = payload }
        else if (event === "continuity" && !creatorReply) { try { payload === null ? window.sessionStorage.removeItem(SIREN_MIND_CONTINUITY_STORAGE_KEY) : window.sessionStorage.setItem(SIREN_MIND_CONTINUITY_STORAGE_KEY, JSON.stringify(payload)) } catch { /* ordinary chat remains usable */ } }
        else if (event === "creator_reply_continuity" && creatorReply) { try { window.sessionStorage.setItem(continuityKey, JSON.stringify(payload)) } catch { /* current chat remains usable */ } }
        else if (event === "error") { batcher.flush(); throw new Error("SIRENS_MIND_STREAM_ERROR") }
      }
      try {
        while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done }); let match: RegExpExecArray | null; while ((match = /\r?\n\r?\n/.exec(buffer))) { applyEvent(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length) } if (done) break }
        if (buffer.trim()) applyEvent(buffer)
      } finally {
        batcher.flush(); batcher.dispose()
        if (activeStreamBatcherRef.current === batcher) activeStreamBatcherRef.current = null
      }
      if (handoff) setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, meta: { generationTarget: handoff!.generation_target, outputType: handoff!.output_type, negativePrompt: handoff!.negative_prompt || initialNegativePrompt || DEFAULT_NEGATIVE_PROMPT, prompt: handoff!.prompt, identityId: handoff!.identity_id, canUseInGenerator: true } } : item))
      return
    }
    const data = (await res.json()) as ConversationResponse | ChatErrorResponse
    if (!res.ok || !("status" in data) || data.status !== "ok") {
      appendMessage({
        id: crypto.randomUUID(), role: "assistant",
        content: "Siren's Mind is temporarily unavailable. Please try again.", isError: true,
      })
      return
    }
    const handoff = data.handoff
    appendMessage({
      id: crypto.randomUUID(), role: "assistant", content: data.reply, completed: true,
      ...(handoff ? { meta: {
        generationTarget: handoff.generation_target,
        outputType: handoff.output_type,
        negativePrompt: handoff.negative_prompt || initialNegativePrompt || DEFAULT_NEGATIVE_PROMPT,
        prompt: handoff.prompt,
        identityId: handoff.identity_id,
        canUseInGenerator: true,
      } } : {}),
    })
  }

  const handleStarterClick = (starter: string) => { void handleSend(starter, mode) }

  const handleNewSubscriber = () => {
    if (requestActive) return
    const next = crypto.randomUUID()
    setMessages([])
    setThreadId(next)
    try { window.sessionStorage.setItem("sirensforge:sirens_mind_creator_reply_thread", next) } catch { /* current tab still has the boundary */ }
  }

  const handleSend = async (userText: string, selectedMode: "SAFE" | "NSFW" | "ULTRA") => {
    const trimmed = userText.trim()
    if (!trimmed || (creatorReply && !threadId)) return
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed }
    const baseMessages = [...messages, userMessage]
    setMessages(baseMessages)
    setIsTyping(true)
    if (creatorReply) setRequestActive(true)
    try {
      await sendChatRequest({ message: trimmed, historyItems: messages, selectedMode })
    } catch (err) {
      console.error("Chat error:", err)
      appendMessage({
        id: crypto.randomUUID(), role: "assistant",
        content: "Siren's Mind is temporarily unavailable. Please try again.", isError: true,
      })
    } finally {
      setIsTyping(false)
      if (creatorReply) setRequestActive(false)
    }
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[#05060a]" />
        <div className="absolute inset-y-0 left-0 w-[22rem] bg-[radial-gradient(circle_at_left,rgba(168,85,247,0.10),transparent_72%)]" />
        <div className="absolute bottom-0 right-0 h-[24rem] w-[28rem] bg-[radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_68%)]" />
      </div>

      <main className="relative z-10 mx-auto flex h-dvh w-full max-w-[78rem] flex-col px-4 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-4 flex shrink-0 flex-col gap-4 border-l-2 border-fuchsia-400/40 pl-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-[28px] font-semibold tracking-tight text-transparent sm:text-[32px]">
              {creatorReply ? "Creator Reply" : "A Siren's Mind"}
            </h1>

            <p className="mt-2 text-[12px] uppercase tracking-[0.16em] text-zinc-500 sm:text-[13px]">
              {creatorReply ? "Paste what they said. Get what to send." : "Erotic Prompt Intelligence"}
            </p>
          </div>

          <nav className="flex flex-wrap gap-2 sm:justify-end">
            {creatorReply ? <button type="button" disabled={requestActive} onClick={handleNewSubscriber} className="rounded-full border border-fuchsia-300/25 bg-fuchsia-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40">New Subscriber</button> : <><button
              type="button"
              onClick={() => window.location.assign("/dashboard")}
              className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-fuchsia-300/30 hover:bg-fuchsia-500/10 hover:text-white"
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() => window.location.assign("/generate")}
              className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:border-cyan-300/40 hover:bg-cyan-500/15 hover:text-white"
            >
              Generator
            </button>
            </>}
          </nav>
        </header>

        {!creatorReply && messages.length === 0 && !isTyping ? (
          <section className="mb-4 shrink-0 rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,10,14,0.82),rgba(7,7,10,0.82))] px-5 py-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300/70">
              Optional Starters
            </div>

            <p className="text-[14px] leading-7 text-zinc-400">
              Pick a shortcut or type your own idea below.
            </p>

            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {[
                "Build a text-to-image scene for my AI Twin",
                "Build a text-to-video scene with cinematic motion",
                "Turn my rough idea into a generator-ready NSFW prompt",
              ].map((starter) => (
                <button
                  key={starter}
                  onClick={() => handleStarterClick(starter)}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left text-[12px] font-medium leading-6 text-zinc-200 transition hover:-translate-y-0.5 hover:border-fuchsia-300/30 hover:bg-fuchsia-500/10 hover:text-white"
                >
                  {starter}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {messages.length > 0 || isTyping ? <section className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-5 pb-5">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isError={msg.isError}
                showUsePrompt={Boolean(msg.meta?.canUseInGenerator)}
                showCopyReply={creatorReply && msg.role === "assistant" && msg.completed === true && !msg.isError}
                userLabel={creatorReply ? "Subscriber" : "You"}
                onUsePrompt={
                  msg.meta?.canUseInGenerator
                    ? () => handleUsePrompt(msg)
                    : undefined
                }
              />
            ))}

            {isTyping && <ChatMessage role="assistant" content="..." isTyping />}

            <div ref={messagesEndRef} className="h-6" />
          </div>
        </section> : null}

        <section className={`shrink-0 border-t border-white/10 bg-black/95 shadow-[0_-18px_40px_rgba(0,0,0,0.55)] ${messages.length > 0 ? "pb-3 pt-2" : "pb-4 pt-3"}`}>
          {messages.length === 0 ? <div className={creatorReply ? "" : "mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between"}>
            {!creatorReply ? <>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fuchsia-200">
                Start Here
              </div>
              <div className="mt-1 text-[12px] text-zinc-500">
                Type the scene, mood, rough idea, or generator goal.
              </div>
            </div>
            <div className="w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
              Chat - Prompt - Generator
            </div>
            </> : null}
          </div> : null}

          <ChatInput
            mode={mode}
            onModeChange={setMode}
            onSend={handleSend}
            compact={messages.length > 0}
            placeholder={creatorReply ? "Paste subscriber message..." : undefined}
          />
        </section>
      </main>
    </div>
  )
}
