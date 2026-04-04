"use client"

import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"

interface ChatMessageProps {
  role: "assistant" | "user"
  content: string
  isStreaming?: boolean
  onStreamComplete?: () => void
  isFirstMessage?: boolean
}

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-black/40 px-3 py-2 backdrop-blur">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-purple-400"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      <span className="text-xs text-gray-400 italic">Siren is thinking...</span>
    </div>
  )
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  isStreaming = false,
  onStreamComplete,
  isFirstMessage = false,
}) => {
  const isAssistant = role === "assistant"
  const [visibleText, setVisibleText] = useState(isStreaming ? "" : content)

  useEffect(() => {
    if (!isStreaming) {
      setVisibleText(content)
      return
    }

    let index = 0
    const interval = setInterval(() => {
      index += 1
      setVisibleText(content.slice(0, index))

      if (index >= content.length) {
        clearInterval(interval)
        onStreamComplete?.()
      }
    }, 10)

    return () => clearInterval(interval)
  }, [isStreaming, content, onStreamComplete])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`mb-6 flex ${isAssistant ? "justify-start" : "justify-end"}`}
    >
      {isAssistant ? (
        <div className="w-full max-w-2xl">
          <div className="rounded-[28px] border border-purple-500/25 bg-[linear-gradient(135deg,rgba(88,28,135,0.30),rgba(10,10,16,0.92)_45%,rgba(76,29,149,0.20))] p-[1px] shadow-[0_0_30px_rgba(168,85,247,0.10)]">
            <div className="rounded-[27px] bg-[linear-gradient(180deg,rgba(10,10,18,0.88),rgba(5,5,10,0.96))] px-5 py-4 md:px-6 md:py-5 backdrop-blur-xl">
              {isFirstMessage && (
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/30 via-pink-500/20 to-cyan-500/20 border border-purple-400/20">
                    <Sparkles className="h-3.5 w-3.5 text-purple-300" />
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-purple-300/90">
                    A Siren&apos;s Mind
                  </div>
                </div>
              )}

              <div className="text-[15px] leading-8 text-gray-100 md:text-base">
                {isStreaming ? visibleText : content}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-xl rounded-[24px] border border-cyan-500/15 bg-[linear-gradient(135deg,rgba(17,24,39,0.96),rgba(15,23,42,0.92))] px-5 py-4 text-sm leading-7 text-gray-100 shadow-[0_0_24px_rgba(34,211,238,0.06)] md:text-base">
          {isStreaming ? visibleText : content}
        </div>
      )}
    </motion.div>
  )
}