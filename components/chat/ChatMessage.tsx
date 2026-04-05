"use client"

import React from "react"

type ChatMessageProps = {
  role: "user" | "assistant"
  content: string
  isError?: boolean
  isTyping?: boolean
}

export function ChatMessage({
  role,
  content,
  isError = false,
  isTyping = false,
}: ChatMessageProps) {
  const isAssistant = role === "assistant"

  if (isTyping) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl border border-purple-500/20 bg-gradient-to-br from-[#0b0b14] to-[#111827] px-5 py-4 shadow-[0_0_30px_rgba(168,85,247,0.08)]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300/80">
            A Siren’s Mind
          </div>

          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" />
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className="flex justify-start">
        <div
          className={`max-w-[85%] rounded-2xl border px-5 py-4 shadow-[0_0_30px_rgba(168,85,247,0.08)] ${
            isError
              ? "border-red-500/30 bg-gradient-to-br from-[#160b0b] to-[#1a1111]"
              : "border-purple-500/20 bg-gradient-to-br from-[#0b0b14] to-[#111827]"
          }`}
        >
          <div
            className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isError ? "text-red-300/80" : "text-purple-300/80"
            }`}
          >
            A Siren’s Mind
          </div>

          <div
            className={`whitespace-pre-wrap text-[15px] leading-7 ${
              isError ? "text-red-100" : "text-zinc-100"
            }`}
          >
            {content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-5 py-4 text-[15px] leading-7 text-zinc-100 border border-white/5">
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}