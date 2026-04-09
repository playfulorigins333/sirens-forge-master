"use client"

import React from "react"

type ChatMessageProps = {
  role: "user" | "assistant"
  content: string
  isError?: boolean
  isTyping?: boolean
  onUsePrompt?: () => void
  showUsePrompt?: boolean
}

export function ChatMessage({
  role,
  content,
  isError = false,
  isTyping = false,
  onUsePrompt,
  showUsePrompt = false,
}: ChatMessageProps) {
  const isAssistant = role === "assistant"

  if (isTyping) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-[24px] border border-fuchsia-500/15 bg-[linear-gradient(180deg,rgba(12,12,16,0.98),rgba(8,8,12,0.98))] px-5 py-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300/80">
            A Siren’s Mind
          </div>

          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400" />
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className="flex justify-start">
        <div
          className={`max-w-[85%] rounded-[24px] border px-5 py-4 ${
            isError
              ? "border-red-500/20 bg-[linear-gradient(180deg,rgba(20,10,10,0.98),rgba(14,8,8,0.98))]"
              : "border-fuchsia-500/15 bg-[linear-gradient(180deg,rgba(12,12,16,0.98),rgba(8,8,12,0.98))]"
          }`}
        >
          <div
            className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isError ? "text-red-300/80" : "text-fuchsia-300/80"
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

          {showUsePrompt && onUsePrompt && !isError && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onUsePrompt}
                className="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-cyan-500/20 px-4 py-2 text-[12px] font-semibold text-white transition hover:border-fuchsia-300/40 hover:from-violet-500/30 hover:via-fuchsia-500/30 hover:to-cyan-500/30"
              >
                Use Prompt in Generator
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,17,22,0.98),rgba(10,10,14,0.98))] px-5 py-4">
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