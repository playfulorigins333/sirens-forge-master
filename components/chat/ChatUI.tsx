"use client"

import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

type Role = "user" | "assistant"

type Message = {
  id: string
  role: Role
  content: string
  isError?: boolean
  meta?: {
    generationTarget?: GenerationTarget
    outputType?: OutputType
    negativePrompt?: string
    canUseInGenerator?: boolean
  }
}

type HeadlessHistoryMessage = {
  role: Role
  content: string
}

type HeadlessSuccessResponse = {
  status: "ok"
  mode: string
  model: string
  output_type: string
  prompt: string
}

type HeadlessRefusalResponse = {
  status: "refused"
  error_code: string
  reason: string
}

type HeadlessErrorResponse = {
  error: string
  reason?: string
  message?: string
}

type GenerationTarget = "text_to_image" | "text_to_video" | "image_to_video"
type OutputType = "IMAGE" | "VIDEO"

type ChatUIProps = {
  initialGenerationTarget?: GenerationTarget | null
}

const TARGET_SELECTION_PROMPT =
  "What are we building this for - text-to-image, text-to-video, or image-to-video?"

const DEFAULT_NEGATIVE_PROMPT =
  "cartoon, 3d, render, low res, low resolution, blurry, poor quality, jpeg artifacts, cgi, bad anatomy, deformed, extra fingers, extra limbs"

const SIREN_MIND_HANDOFF_STORAGE_KEY = "sirensforge:siren_mind_handoff"

function targetToOutputType(target: GenerationTarget): OutputType {
  if (target === "text_to_image") return "IMAGE"
  return "VIDEO"
}

function targetToLabel(target: GenerationTarget): string {
  switch (target) {
    case "text_to_image":
      return "text-to-image"
    case "text_to_video":
      return "text-to-video"
    case "image_to_video":
      return "image-to-video"
    default:
      return "text-to-image"
  }
}

function parseGenerationTarget(input: string): GenerationTarget | null {
  const normalized = input.trim().toLowerCase()

  const compact = normalized
    .replace(/[_–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (
    compact.includes("image to video") ||
    compact.includes("img to video") ||
    compact.includes("image into video") ||
    compact.includes("animate image") ||
    compact.includes("animate this image")
  ) {
    return "image_to_video"
  }

  if (
    compact.includes("text to video") ||
    compact.includes("prompt to video") ||
    compact === "video" ||
    compact === "text video"
  ) {
    return "text_to_video"
  }

  if (
    compact.includes("text to image") ||
    compact.includes("prompt to image") ||
    compact.includes("still image") ||
    compact === "image" ||
    compact === "still"
  ) {
    return "text_to_image"
  }

  return null
}

export default function ChatUI({
  initialGenerationTarget = null,
}: ChatUIProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [mode, setMode] = useState<"SAFE" | "NSFW" | "ULTRA">("SAFE")
  const [generationTarget, setGenerationTarget] =
    useState<GenerationTarget | null>(initialGenerationTarget)
  const [awaitingGenerationTarget, setAwaitingGenerationTarget] =
    useState(false)
  const [pendingDescription, setPendingDescription] = useState<string | null>(
    null,
  )
  const [pendingHistoryBase, setPendingHistoryBase] = useState<Message[] | null>(
    null,
  )

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialGenerationTarget) {
      setGenerationTarget(initialGenerationTarget)
      setAwaitingGenerationTarget(false)
      setPendingDescription(null)
      setPendingHistoryBase(null)
    }
  }, [initialGenerationTarget])

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

  const buildHistory = (items: Message[]): HeadlessHistoryMessage[] => {
    return items.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }))
  }

  const handleUsePrompt = (msg: Message) => {
    if (!msg.meta?.canUseInGenerator) return

    const handoffPayload = {
      prompt: msg.content,
      negative_prompt: msg.meta.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
      output_type: msg.meta.outputType || "IMAGE",
      generation_target: msg.meta.generationTarget || "text_to_image",
      created_at: Date.now(),
    }

    try {
      window.sessionStorage.setItem(
        SIREN_MIND_HANDOFF_STORAGE_KEY,
        JSON.stringify(handoffPayload),
      )
    } catch (err) {
      console.error("Failed to store Siren's Mind handoff:", err)
    }

    const params = new URLSearchParams({
      prompt: handoffPayload.prompt,
      negative_prompt: handoffPayload.negative_prompt,
      output_type: handoffPayload.output_type,
      generation_target: handoffPayload.generation_target,
      source: "siren_mind",
    })

    window.location.assign("/generate?" + params.toString())
  }

  const sendHeadlessRequest = async ({
    description,
    target,
    historyItems,
  }: {
    description: string
    target: GenerationTarget
    historyItems: Message[]
  }) => {
    const resolvedOutputType = targetToOutputType(target)

    const res = await fetch("/api/nsfw-gpt/headless", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        description,
        output_type: resolvedOutputType,
        generation_target: target,
        history: buildHistory(historyItems),
      }),
    })

    const data = (await res.json()) as
      | HeadlessSuccessResponse
      | HeadlessRefusalResponse
      | HeadlessErrorResponse

    await new Promise((r) => setTimeout(r, 350))

    if ("status" in data && data.status === "ok") {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.prompt,
        meta: {
          generationTarget: target,
          outputType: resolvedOutputType,
          negativePrompt: DEFAULT_NEGATIVE_PROMPT,
          canUseInGenerator: true,
        },
      })
      return
    }

    if ("error_code" in data) {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.error_code + ": " + data.reason,
        isError: true,
      })
      return
    }

    if ("error" in data) {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reason || data.message || data.error,
        isError: true,
      })
      return
    }

    appendMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "SYSTEM_ERROR: Invalid response format.",
      isError: true,
    })
  }

  const handleStarterClick = (starter: string) => {
    void handleSend(starter)
  }

  const handleSend = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed) return

    if (awaitingGenerationTarget) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      }

      setMessages((prev) => [...prev, userMessage])

      const resolvedTarget = parseGenerationTarget(trimmed)

      if (!resolvedTarget) {
        appendMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Choose one so I can shape it correctly: text-to-image, text-to-video, or image-to-video.",
          isError: true,
        })
        return
      }

      setGenerationTarget(resolvedTarget)
      setAwaitingGenerationTarget(false)

      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Got it - I'll use " +
          targetToLabel(resolvedTarget) +
          " for this thread.",
      })

      const descriptionToSend = pendingDescription
      const historyBase = pendingHistoryBase

      setPendingDescription(null)
      setPendingHistoryBase(null)

      if (!descriptionToSend) {
        return
      }

      const syntheticPendingUserMessage: Message = {
        id: "pending-description",
        role: "user",
        content: descriptionToSend,
      }

      const historyItems = [...(historyBase ?? []), syntheticPendingUserMessage]

      setIsTyping(true)

      try {
        await sendHeadlessRequest({
          description: descriptionToSend,
          target: resolvedTarget,
          historyItems,
        })
      } catch (err) {
        console.error("Chat error:", err)

        appendMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "SYSTEM_ERROR: Failed to reach prompt engine.",
          isError: true,
        })
      } finally {
        setIsTyping(false)
      }

      return
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    }

    const baseMessages = [...messages, userMessage]
    setMessages(baseMessages)

    if (!generationTarget) {
      setPendingDescription(trimmed)
      setPendingHistoryBase(messages)
      setAwaitingGenerationTarget(true)

      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: TARGET_SELECTION_PROMPT,
      })

      return
    }

    setIsTyping(true)

    try {
      await sendHeadlessRequest({
        description: trimmed,
        target: generationTarget,
        historyItems: baseMessages,
      })
    } catch (err) {
      console.error("Chat error:", err)

      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "SYSTEM_ERROR: Failed to reach prompt engine.",
        isError: true,
      })
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[#05060a]" />
        <div className="absolute inset-y-0 left-0 w-[22rem] bg-[radial-gradient(circle_at_left,rgba(168,85,247,0.10),transparent_72%)]" />
        <div className="absolute bottom-0 right-0 h-[24rem] w-[28rem] bg-[radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_68%)]" />
      </div>

      <main className="relative z-10 mx-auto flex h-screen w-full max-w-4xl flex-col px-4 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-4 flex shrink-0 flex-col gap-4 border-l-2 border-fuchsia-400/40 pl-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-[28px] font-semibold tracking-tight text-transparent sm:text-[32px]">
              A Siren's Mind
            </h1>

            <p className="mt-2 text-[12px] uppercase tracking-[0.16em] text-zinc-500 sm:text-[13px]">
              Erotic Prompt Intelligence
            </p>
          </div>

          <nav className="flex flex-wrap gap-2 sm:justify-end">
            <button
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
          </nav>
        </header>

        {messages.length === 0 && !isTyping ? (
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

        <section className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-5 pb-5">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isError={msg.isError}
                showUsePrompt={Boolean(msg.meta?.canUseInGenerator)}
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
        </section>

        <section className="shrink-0 border-t border-white/10 bg-black/95 pb-4 pt-3 shadow-[0_-18px_40px_rgba(0,0,0,0.55)]">
          <div className="mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
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
          </div>

          <ChatInput
            mode={mode}
            onModeChange={setMode}
            onSend={handleSend}
          />
        </section>
      </main>
    </div>
  )
}
