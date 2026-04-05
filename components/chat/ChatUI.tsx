"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

type Role = "user" | "assistant"

type Message = {
  id: string
  role: Role
  content: string
  isError?: boolean
}

type HeadlessRequest = {
  mode: "SAFE" | "NSFW" | "ULTRA"
  intent: string
  output_format: "plain" | "structured"
  dna_decision: "none" | "save" | "reuse"
  stack_depth: "light" | "medium" | "deep"
  description: string
}

type HeadlessSuccessResponse = {
  status: "ok"
  mode: string
  model: string
  result: {
    prompt: string
    negative_prompt?: string
    tags?: string[]
    style?: string
    metadata?: Record<string, any>
  }
}

type HeadlessRefusalResponse = {
  status: "refused"
  error_code: string
  reason: string
}

export default function ChatUI() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      content:
        "Tell me what you want to create — I’ll shape it into something strong, refined, and ready to use.",
    },
  ])

  const [isTyping, setIsTyping] = useState(false)

  const [mode, setMode] = useState<"SAFE" | "NSFW" | "ULTRA">("SAFE")
  const [intent] = useState<string>("image_prompt")
  const [outputFormat] = useState<"plain">("plain")
  const [dnaDecision] = useState<"none">("none")
  const [stackDepth] = useState<"light">("light")

  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const handleSend = async (userText: string) => {
    if (!userText.trim()) return

    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
    })

    setIsTyping(true)

    const payload: HeadlessRequest = {
      mode,
      intent,
      output_format: outputFormat,
      dna_decision: dnaDecision,
      stack_depth: stackDepth,
      description: userText,
    }

    try {
      const res = await fetch("/api/nsfw-gpt/headless", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const data = (await res.json()) as
        | HeadlessSuccessResponse
        | HeadlessRefusalResponse

      await new Promise((r) => setTimeout(r, 350))

      if ("error_code" in data) {
        appendMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${data.error_code}: ${data.reason}`,
          isError: true,
        })
      } else {
        appendMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.result.prompt,
        })
      }
    } catch {
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
    <div className="relative flex h-screen w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.14),transparent_30%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_24%),linear-gradient(to_bottom,rgba(20,20,28,0.65),rgba(0,0,0,1))]" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:radial-gradient(#ffffff_0.6px,transparent_0.6px)] [background-size:18px_18px]" />
      </div>

      <div className="relative flex min-w-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/6 bg-black/45 backdrop-blur-md">
            <div className="mx-auto w-full max-w-5xl px-6 pb-4 pt-7">
              <div className="flex items-end justify-between gap-6">
                <div className="max-w-2xl">
                  <h1 className="text-3xl font-semibold tracking-tight text-purple-400">
                    A Siren’s Mind
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Erotic Prompt Intelligence
                  </p>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-300">
                    Describe the scene, mood, identity, or direction you want.
                    Siren’s Mind will refine it into a stronger, generator-ready result.
                  </p>
                </div>

                <div className="hidden shrink-0 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500 md:block">
                  Chat-first creative engine
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-44 pt-8">
                <div className="mx-auto flex w-full max-w-5xl flex-col">
                  <div className="mb-8 max-w-3xl rounded-3xl border border-purple-500/10 bg-gradient-to-br from-[#0a0812]/90 via-[#0b1020]/75 to-[#09090b]/90 px-6 py-5 shadow-[0_0_60px_rgba(168,85,247,0.06)]">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-purple-300/70">
                      A Siren’s Mind
                    </div>
                    <p className="text-base leading-8 text-zinc-100">
                      Tell me what you want to create — I’ll shape it into something strong,
                      refined, and ready to use.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">
                      If you’re building around a character or consistent identity, I’ll keep
                      that continuity intact while refining the scene.
                    </p>
                  </div>

                  <div className="flex flex-col gap-6">
                    {messages.slice(1).map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        role={msg.role}
                        content={msg.content}
                        isError={msg.isError}
                      />
                    ))}

                    {isTyping && (
                      <ChatMessage role="assistant" content="…" isTyping />
                    )}

                    <div ref={bottomRef} />
                  </div>
                </div>
              </div>

              <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/8 bg-black/80 backdrop-blur-xl">
                <div className="mx-auto w-full max-w-5xl px-6 py-4">
                  <div className="rounded-[28px] border border-white/8 bg-gradient-to-br from-[#05070d]/95 to-[#0b1222]/95 p-3 shadow-[0_-10px_40px_rgba(0,0,0,0.35)]">
                    <ChatInput
                      mode={mode}
                      onModeChange={setMode}
                      onSend={handleSend}
                    />
                  </div>
                </div>
              </div>
            </section>

            <aside className="hidden w-72 shrink-0 border-l border-white/6 bg-black/35 backdrop-blur-md xl:block">
              <div className="sticky top-0 p-6">
                <div className="mb-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Current Stack
                  </div>
                </div>

                <div className="space-y-5 text-sm">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      Mode
                    </div>
                    <div className="text-zinc-300">{mode}</div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      Intent
                    </div>
                    <div className="text-zinc-500">—</div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      DNA
                    </div>
                    <div className="text-zinc-500">—</div>
                  </div>

                  <div className="pt-4 text-xs leading-6 text-zinc-600">
                    This panel reflects session state as Siren’s Mind builds context.
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  )
}