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

export default function ChatUI() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [mode, setMode] = useState<"SAFE" | "NSFW" | "ULTRA">("SAFE")

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Do NOT auto-scroll on initial page load.
    // Only scroll after real conversation begins or while typing is active.
    if (messages.length === 0 && !isTyping) return

    const id = window.setTimeout(() => {
      const el = scrollContainerRef.current
      if (!el) return
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      })
    }, 80)

    return () => window.clearTimeout(id)
  }, [messages, isTyping])

  const appendMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg])
  }

  const buildHistory = (items: Message[]): HeadlessHistoryMessage[] => {
    // Keep prior thread only.
    // The newest user message is passed separately as `description`.
    return items.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }))
  }

  const detectOutputType = (text: string): "IMAGE" | "VIDEO" | "STORY" => {
    const normalized = text.toLowerCase()

    const videoSignals = [
      "video",
      "scene",
      "camera movement",
      "camera move",
      "slow pan",
      "dolly",
      "tracking shot",
      "shot list",
      "motion",
      "animate",
      "animation",
      "20 second",
      "25 second",
      "text-to-video",
      "image-to-video",
    ]

    const storySignals = [
      "write a scene",
      "write this as",
      "story",
      "prose",
      "narrative",
      "story beat",
      "dialogue scene",
    ]

    if (videoSignals.some((s) => normalized.includes(s))) return "VIDEO"
    if (storySignals.some((s) => normalized.includes(s))) return "STORY"
    return "IMAGE"
  }

  const handleStarterClick = (starter: string) => {
    void handleSend(starter)
  }

  const handleSend = async (userText: string) => {
    if (!userText.trim()) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setIsTyping(true)

    try {
      const outputType = detectOutputType(userText)

      const res = await fetch("/api/nsfw-gpt/headless", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          description: userText,
          output_type: outputType,
          history: buildHistory(nextMessages),
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
        })
        return
      }

      if ("error_code" in data) {
        appendMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${data.error_code}: ${data.reason}`,
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
    <div className="relative flex h-screen w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[#05060a]" />
        <div className="absolute inset-y-0 left-0 w-[22rem] bg-[radial-gradient(circle_at_left,rgba(168,85,247,0.10),transparent_72%)]" />
      </div>

      <main className="relative flex min-w-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/5 bg-[linear-gradient(180deg,rgba(7,7,11,0.98),rgba(5,6,10,0.98))]">
            <div className="mx-auto w-full max-w-4xl px-6 py-6">
              <div className="border-l-2 border-fuchsia-400/40 pl-5">
                <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-[32px] font-semibold tracking-tight text-transparent">
                  A Siren’s Mind
                </h1>

                <p className="mt-2 text-[13px] uppercase tracking-[0.16em] text-zinc-500">
                  Erotic Prompt Intelligence
                </p>
              </div>
            </div>
          </header>

          <div
            ref={scrollContainerRef}
            className="min-h-0 flex-1 overflow-y-auto px-6 pb-[19rem] pt-5"
          >
            <div className="mx-auto w-full max-w-4xl">
              <div className="mb-5 rounded-[24px] border border-fuchsia-500/10 bg-[linear-gradient(180deg,rgba(10,10,14,0.98),rgba(7,7,10,0.98))] px-7 py-6">
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

                <p className="mt-3 text-[14px] leading-7 text-zinc-400">
                  I’ll shape it into something stronger and ready to use.
                </p>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {[
                    "Build a polished feminine character prompt with luxury styling",
                    "Turn this rough idea into a stronger image prompt",
                    "Create something darker, moodier, and more seductive",
                  ].map((starter) => (
                    <button
                      key={starter}
                      onClick={() => handleStarterClick(starter)}
                      className="rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 px-4 py-3 text-left text-white"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-5">
                {messages.map((msg) => (
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

                <div className="h-12" />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/5 bg-black/90">
            <div className="mx-auto w-full max-w-4xl px-6 py-4">
              <ChatInput
                mode={mode}
                onModeChange={setMode}
                onSend={handleSend}
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}