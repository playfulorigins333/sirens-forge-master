"use client"

import React, { useState, useRef } from "react"
import { motion } from "framer-motion"
import { Send } from "lucide-react"

interface ChatInputProps {
  onSendMessage: (content: string) => void
  disabled?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  disabled = false,
}) => {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    onSendMessage(trimmed)
    setValue("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="relative">
      <div className="relative flex items-end gap-3 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 shadow-xl">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={
            disabled
              ? "Please wait…"
              : "Describe what you want to create…"
          }
          className="flex-1 resize-none bg-transparent text-sm md:text-base text-gray-100 placeholder-gray-500 focus:outline-none max-h-40"
        />

        <motion.button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          whileHover={!disabled ? { scale: 1.05 } : undefined}
          whileTap={!disabled ? { scale: 0.95 } : undefined}
          className={`rounded-xl p-3 transition-colors ${
            disabled || !value.trim()
              ? "bg-gray-700 text-gray-500 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500"
          }`}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  )
}
