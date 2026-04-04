"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { X, Check } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { ChatMessage, TypingIndicator } from "@/components/chat/ChatMessage"
import { ChatInput } from "@/components/chat/ChatInput"

type Mode = "SAFE" | "NSFW" | "ULTRA"

interface Message {
  id: string
  role: "assistant" | "user"
  content: string
  isStreaming?: boolean
  isError?: boolean
}

interface StackState {
  mode: Mode
  intent: string | null
}

export default function Page() {
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Welcome to A Siren's Mind.\n\nI guide prompt construction with precision.\n\nWhat would you like to create?",
    },
  ])

  const [isTyping, setIsTyping] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [stackState, setStackState] = useState<StackState>({
    mode: "SAFE",
    intent: null,
  })

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const handleSendMessage = async (content: string) => {
    const trimmed = content?.trim()
    if (!trimmed) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    }

    setMessages((prev) => [...prev, userMessage])

    // simple intent hint
    if (trimmed.toLowerCase().includes("image")) {
      setStackState((p) => ({ ...p, intent: "image_prompt" }))
    }

    if (trimmed.toLowerCase().includes("generate")) {
      setShowConfirmation(true)
      return
    }

    setIsTyping(true)

    try {
      const res = await fetch("/api/nsfw-gpt/headless", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: stackState.mode,
          intent: stackState.intent || "image_prompt",
          description: trimmed,
          output_format: "plain",
        }),
      })

      const data = await res.json()

      setIsTyping(false)
      setIsStreaming(true)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data?.result?.prompt || "SYSTEM_ERROR: Missing prompt",
        isStreaming: true,
        isError: !data?.result?.prompt,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      setIsTyping(false)
      setIsStreaming(true)

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "SYSTEM_ERROR: Failed to reach prompt engine",
          isStreaming: true,
          isError: true,
        },
      ])
    }
  }

  const handleStreamComplete = () => {
    setIsStreaming(false)
    setMessages((prev) => prev.map((m) => ({ ...m, isStreaming: false })))
  }

  const handleConfirm = () => {
    setShowConfirmation(false)

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content:
          "Prompt confirmed.\n\nNext step: move this into Generate page for execution.",
        isStreaming: true,
      },
    ])
  }

  if (!mounted) return null

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      {/* HEADER */}
      <div className="border-b border-gray-800 p-4">
        <h1 className="text-xl font-bold">A Siren's Mind</h1>
        <p className="text-xs text-gray-400">Erotic Prompt Intelligence</p>
      </div>

      {/* CHAT */}
      <div className="flex-1 overflow-y-auto p-4 pb-32">
        {messages.map((m, i) => (
          <ChatMessage
            key={m.id}
            role={m.role}
            content={m.content}
            isStreaming={m.isStreaming}
            onStreamComplete={handleStreamComplete}
            isFirstMessage={i === 0}
          />
        ))}

        <AnimatePresence>{isTyping && <TypingIndicator />}</AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-black p-4">
        <ChatInput onSendMessage={handleSendMessage} disabled={isTyping || isStreaming} />
      </div>

      {/* CONFIRM MODAL */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div className="fixed inset-0 bg-black/80 flex items-center justify-center">
            <div className="bg-gray-900 p-6 rounded-lg max-w-md w-full">
              <h2 className="text-lg font-bold mb-4">Confirm Prompt</h2>

              <div className="flex gap-2">
                <Button onClick={() => setShowConfirmation(false)} variant="outline">
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>

                <Button onClick={handleConfirm}>
                  <Check className="w-4 h-4 mr-2" /> Confirm
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}