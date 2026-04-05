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

    return (
      <button
        type="button"
        onClick={() => onModeChange(label)}
        className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
          active
            ? label === "SAFE"
              ? "bg-emerald-500 text-white"
              : label === "NSFW"
              ? "bg-amber-500 text-black"
              : "bg-purple-500 text-white"
            : "bg-zinc-800 text-zinc-400 hover:text-white"
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {modeButton("SAFE")}
        {modeButton("NSFW")}
        {modeButton("ULTRA")}
      </div>

      <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-[#0f172a] px-4 py-3 shadow-[0_0_40px_rgba(59,130,246,0.08)]">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to create..."
          rows={1}
          className="max-h-48 min-h-[28px] flex-1 resize-none bg-transparent text-[15px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || sending}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-700 text-zinc-200 transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
        >
          ↗
        </button>
      </div>
    </div>
  )
}