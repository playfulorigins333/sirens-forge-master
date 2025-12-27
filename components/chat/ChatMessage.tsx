"use client"

import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"

interface ChatMessageProps {
  role: "assistant" | "user"
  content: string
  isStreaming?: boolean
  onStreamComplete?: () => void
  isFirstMessage?: boolean
}

/**
 * Typing indicator (three animated dots)
 */
export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex items-center gap-2 py-4">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 rounded-full bg-purple-400"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <span className="text-xs text-gray-400 italic">Siren is thinking…</span>
    </div>
  )
}

/**
 * Chat message bubble
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  isStreaming = false,
  onStreamComplete,
  isFirstMessage = false,
}) => {
  const isAssistant = role === "assistant"
  const [visibleText, setVisibleText] = useState(isStreaming ? "" : content)

  // Simulated streaming text (character-by-character)
  useEffect(() => {
    if (!isStreaming) return

    let index = 0
    const interval = setInterval(() => {
      index++
      setVisibleText(content.slice(0, index))

      if (index >= content.length) {
        clearInterval(interval)
        onStreamComplete?.()
      }
    }, 12)

    return () => clearInterval(interval)
  }, [isStreaming, content, onStreamComplete])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`mb-6 flex ${isAssistant ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 whitespace-pre-wrap leading-relaxed ${
          isAssistant
            ? "bg-gradient-to-br from-purple-900/40 via-black to-purple-900/30 border border-purple-500/30 text-gray-100"
            : "bg-gray-800 text-gray-100"
        }`}
      >
        {isFirstMessage && isAssistant && (
          <div className="text-xs uppercase tracking-wider text-purple-400 mb-2">
            A Siren’s Mind
          </div>
        )}

        <div className="text-sm md:text-base">
          {isStreaming ? visibleText : content}
        </div>
      </div>
    </motion.div>
  )
}
