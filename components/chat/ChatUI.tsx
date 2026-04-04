"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Shield, Users, Star } from "lucide-react"
import { motion } from "framer-motion"
import { ChatMessage, TypingIndicator } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

type Mode = "SAFE" | "NSFW" | "ULTRA"

interface Message {
  id: string
  role: "assistant" | "user"
  content: string
  isStreaming?: boolean
}

export const ChatUI: React.FC = () => {
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
  const [mode, setMode] = useState<Mode>("SAFE")

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content },
    ])

    setIsTyping(true)

    setTimeout(() => {
      setIsTyping(false)
      setIsStreaming(true)

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "This is a response from Siren’s Mind.",
          isStreaming: true,
        },
      ])
    }, 600)
  }

  const getModeColor = (m: Mode) => {
    switch (m) {
      case "SAFE":
        return "bg-emerald-500"
      case "NSFW":
        return "bg-amber-500"
      case "ULTRA":
        return "bg-rose-600"
    }
  }

  const getModeIcon = (m: Mode) => {
    switch (m) {
      case "SAFE":
        return Shield
      case "NSFW":
        return Users
      case "ULTRA":
        return Star
    }
  }

  return (
    <div className="h-screen flex bg-black text-white">

      {/* MAIN COLUMN */}
      <div className="flex-1 flex flex-col">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-gray-800 bg-black/70 backdrop-blur">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            A Siren’s Mind
          </h1>

          {/* MODE */}
          <div className="flex gap-2 mt-3">
            {(["SAFE", "NSFW", "ULTRA"] as Mode[]).map((m) => {
              const Icon = getModeIcon(m)
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${
                    mode === m
                      ? `${getModeColor(m)} text-white`
                      : "bg-gray-800 text-gray-400"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {m}
                </button>
              )
            })}
          </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto w-full">

            {messages.map((msg, i) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isStreaming={msg.isStreaming}
                isFirstMessage={i === 0}
              />
            ))}

            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />

          </div>
        </div>

        {/* INPUT (NOW PROPERLY DOCKED) */}
        <div className="border-t border-gray-800 bg-black/80 px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput onSendMessage={handleSendMessage} />
          </div>
        </div>
      </div>

      {/* SIDEBAR (SOFTENED + SMALLER) */}
      <div className="hidden md:flex w-64 border-l border-gray-800 bg-black/70 p-4">
        <div className="text-sm text-gray-400">
          <div className="mb-4 font-bold text-white">Current Stack</div>
          <div>Mode: {mode}</div>
          <div>Intent: —</div>
          <div>DNA: —</div>
        </div>
      </div>

    </div>
  )
}