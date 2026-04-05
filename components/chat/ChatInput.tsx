"use client"

import React, { useState } from "react"

type Mode = "SAFE" | "NSFW" | "ULTRA"

type ChatInputProps = {
  mode: Mode
  onModeChange: React.Dispatch<React.SetStateAction<Mode>>
  onSend: (userText: string) => Promise<void> | void
}

export function ChatInput({
  mode,
  onModeChange,
  onSend,
}: ChatInputProps) {
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      await onSend(trimmed)
      setValue("")
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = async (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      await submit()
    }
  }

  const modeButton = (label: Mode) => {
    const active = mode === label

    const activeClasses =
      label === "SAFE"
        ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
        : label === "NSFW"
        ? "border-amber-400/40 bg-amber-500/20 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
        : "border-purple-400/40 bg-purple-500/20 text-purple-100 shadow-[0_0_24px_rgba(168,85,247,0.18)]"

    return (
      <button
        type="button"
        onClick={() => onModeChange(label)}
        className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all duration-200 ${
          active
            ? activeClasses
            : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {modeButton("SAFE")}
        {modeButton("NSFW")}
        {modeButton("ULTRA")}
      </div>

      <div className="rounded-[26px] border border-white/10 bg-gradient-to-br from-[#0d1322] via-[#0b1220] to-[#09101d] p-3 shadow-[0_0_40px_rgba(59,130,246,0.08)] transition-all duration-200 focus-within:border-purple-400/20 focus-within:shadow-[0_0_50px_rgba(168,85,247,0.16)]">
        <div className="flex items-end gap-3 rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the mood, character, scene, or prompt you want to create..."
            rows={1}
            className="max-h-48 min-h-[34px] flex-1 resize-none bg-transparent text-[15px] leading-7 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || sending}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-zinc-200 shadow-[0_6px_20px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.03] hover:border-purple-400/30 hover:bg-purple-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            aria-label="Send"
          >
            <span className="text-lg leading-none">↗</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between px-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Press Enter to send
          </div>
          <div className="text-[11px] text-zinc-500">
            Shift + Enter for a new line
          </div>
        </div>
      </div>
    </div>
  )
}