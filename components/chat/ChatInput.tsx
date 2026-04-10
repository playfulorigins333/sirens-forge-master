"use client"

import React, { useEffect, useState } from "react"

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
  const [localMode, setLocalMode] = useState<Mode>(mode)

  useEffect(() => {
    setLocalMode(mode)
  }, [mode])

  const handleModeChange = (nextMode: Mode) => {
    setLocalMode(nextMode)
    onModeChange(nextMode)
  }

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || sending) return

    // Force parent to receive the latest selected mode before send
    if (mode !== localMode) {
      onModeChange(localMode)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }

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
    const active = localMode === label

    return (
      <button
        type="button"
        onClick={() => handleModeChange(label)}
        className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all duration-200 ${
          active
            ? "border-transparent bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 text-white shadow-[0_0_18px_rgba(168,85,247,0.16)]"
            : "border-white/10 bg-[#111218] text-zinc-400 hover:border-white/20 hover:bg-[#15161d] hover:text-white"
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {modeButton("SAFE")}
        {modeButton("NSFW")}
        {modeButton("ULTRA")}
      </div>

      <div className="rounded-[24px] border border-white/10 bg-[#0d0e13] p-3">
        <div className="flex items-end gap-3 rounded-[20px] border border-white/10 bg-black px-4 py-3">
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
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-transparent bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 text-white shadow-[0_0_18px_rgba(168,85,247,0.16)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
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