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
        <div className="max-w-[85%] rounded-[24px] border border-purple-500/20 bg-gradient-to-br from-[#0b0b14] via-[#0d1020] to-[#111827] px-5 py-4 shadow-[0_0_32px_rgba(168,85,247,0.10)]">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300/80">
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
          className={`max-w-[85%] rounded-[24px] border px-5 py-4 shadow-[0_0_32px_rgba(168,85,247,0.10)] ${
            isError
              ? "border-red-500/30 bg-gradient-to-br from-[#160b0b] via-[#1a1010] to-[#1a1111]"
              : "border-purple-500/20 bg-gradient-to-br from-[#0b0b14] via-[#0d1020] to-[#111827]"
          }`}
        >
          <div
            className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isError ? "text-red-300/80" : "text-purple-300/80"
            }`}
          >
            A Siren’s Mind
          </div>

          <div
            className={`whitespace-pre-wrap text-[15px] leading-8 ${
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
      <div className="max-w-[85%] rounded-[24px] border border-white/10 bg-gradient-to-br from-[#161616] to-[#111111] px-5 py-4 shadow-[0_10px_28px_rgba(0,0,0,0.22)]">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          You
        </div>

        <div className="whitespace-pre-wrap text-[15px] leading-8 text-zinc-100">
          {content}
        </div>
      </div>
    </div>
  )
}