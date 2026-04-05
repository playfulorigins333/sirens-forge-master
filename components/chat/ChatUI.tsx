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
  const [intent, setIntent] = useState<string>("image_prompt")
  const [outputFormat] = useState<"plain">("plain")
  const [dnaDecision] = useState<"none">("none")
  const [stackDepth] = useState<"light">("light")

  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const appendMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg])
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

      await new Promise(r => setTimeout(r, 350))

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
    <div className="flex h-screen w-full bg-black text-white">
      {/* MAIN CHAT AREA */}
      <div className="flex flex-1 flex-col">

        {/* HEADER */}
        <div className="px-6 pt-6 pb-3">
          <h1 className="text-xl font-semibold tracking-tight text-purple-400">
            A Siren’s Mind
          </h1>
          <div className="mt-3 flex gap-2">
            {["SAFE", "NSFW", "ULTRA"].map(m => (
              <button
                key={m}
                onClick={() => setMode(m as any)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                  mode === m
                    ? "bg-purple-500 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* CHAT STREAM */}
        <div className="flex-1 overflow-y-auto px-6 pb-32 pt-4">
          <div className="max-w-3xl mx-auto space-y-6">

            {messages.map(msg => (
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

        {/* INPUT */}
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-black/90 backdrop-blur px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              mode={mode}
              onModeChange={setMode}
              onSend={handleSend}
            />
          </div>
        </div>
      </div>

      {/* SIDEBAR (DE-EMPHASIZED) */}
      <div className="hidden md:flex w-72 border-l border-gray-900 bg-black/60 backdrop-blur-sm p-6">
        <div className="text-xs text-gray-500 space-y-3">
          <div className="text-gray-400 font-semibold">Current Stack</div>
          <div>Mode: {mode}</div>
          <div>Intent: —</div>
          <div>DNA: —</div>
        </div>
      </div>
    </div>
  )
}