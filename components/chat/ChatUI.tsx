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
        "Tell me what you want to create — a mood, a character, a scene, or a polished prompt. I’ll shape it into something stronger and ready to use.",
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
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    })
  }, [messages, isTyping])

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const handleStarterClick = (starter: string) => {
    void handleSend(starter)
  }

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
        <div className="absolute inset-0 bg-[#05060a]" />
        <div className="absolute inset-y-0 left-0 w-[22rem] bg-[radial-gradient(circle_at_left,rgba(168,85,247,0.10),transparent_72%)]" />
      </div>

      <main className="relative flex min-w-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/5 bg-[linear-gradient(180deg,rgba(7,7,11,0.98),rgba(5,6,10,0.98))]">
            <div className="mx-auto w-full max-w-4xl px-6 py-7">
              <div className="inline-flex items-center rounded-full border border-fuchsia-500/20 bg-fuchsia-500/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-200/85">
                SirensForge Intelligence
              </div>

              <h1 className="mt-4 bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-[34px] font-semibold tracking-tight text-transparent">
                A Siren’s Mind
              </h1>

              <p className="mt-2 max-w-2xl text-[14px] leading-7 text-zinc-400">
                Erotic Prompt Intelligence
              </p>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[19rem] pt-5">
            <div className="mx-auto w-full max-w-4xl">
              <div className="mb-5 rounded-[24px] border border-fuchsia-500/10 bg-[linear-gradient(180deg,rgba(10,10,14,0.98),rgba(7,7,10,0.98))] px-7 py-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300/80">
                  A Siren’s Mind
                </div>

                <p className="text-[18px] font-medium leading-8 text-white">
                  Tell me what you want to create
                  <span className="font-normal text-zinc-200">
                    {" "}
                    — a mood, a character, a scene, or a polished prompt.
                  </span>
                </p>

                <p className="mt-3 max-w-3xl text-[14px] leading-7 text-zinc-400">
                  I’ll shape it into something stronger and ready to use.
                </p>

                <div className="mt-5">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Start with one of these
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      "Build a polished feminine character prompt with luxury styling",
                      "Turn this rough idea into a stronger image prompt",
                      "Create something darker, moodier, and more seductive",
                    ].map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => handleStarterClick(starter)}
                        className="rounded-2xl border border-transparent bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 px-4 py-3 text-left text-[13px] font-medium leading-6 text-white shadow-[0_0_18px_rgba(168,85,247,0.16)] transition-all duration-200 hover:brightness-110"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-5">
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

                <div ref={bottomRef} className="h-8 scroll-mb-[18rem]" />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/5 bg-[rgba(5,6,10,0.94)] backdrop-blur-xl">
            <div className="mx-auto w-full max-w-4xl px-6 py-4">
              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,12,16,0.98),rgba(8,8,12,0.98))] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                <ChatInput
                  mode={mode}
                  onModeChange={setMode}
                  onSend={handleSend}
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden w-72 shrink-0 border-l border-white/5 bg-[linear-gradient(180deg,rgba(9,9,13,0.98),rgba(6,6,9,0.98))] xl:block">
          <div className="sticky top-0 p-6">
            <div className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Current Stack
            </div>

            <div className="space-y-6 text-sm">
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  Mode
                </div>
                <div className="text-zinc-200">{mode}</div>
              </div>

              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  Intent
                </div>
                <div className="text-zinc-500">—</div>
              </div>

              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  DNA
                </div>
                <div className="text-zinc-500">—</div>
              </div>

              <div className="pt-4 text-xs leading-7 text-zinc-600">
                This panel reflects session state as Siren’s Mind builds
                context.
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}