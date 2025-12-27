"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Shield, Users, Star, X, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChatMessage, TypingIndicator } from "@/components/chat/ChatMessage"
import { ChatInput } from "@/components/chat/ChatInput"

type Mode = 'SAFE' | 'NSFW' | 'ULTRA'

interface Message {
  id: string
  role: 'assistant' | 'user'
  content: string
  isStreaming?: boolean
}

interface StackState {
  mode: Mode
  intent: string | null
  dna: string | null
  vaults: string[]
  macros: string[]
}

const mockResponses = [
  "Understood. Continue.",
  "Tell me more about your vision.",
  "What specific elements are most important?",
  "I can help refine that concept.",
  "Describe the mood you want to capture.",
  "What style resonates with you?",
  "Let's build on that foundation.",
  "Consider the emotional tone.",
  "What details matter most?"
]

const FloatingParticles = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    {[...Array(30)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute w-1 h-1 bg-purple-400 rounded-full"
        style={{ left: `${Math.random() * 100}%`, filter: 'blur(1px)' }}
        initial={{ y: '100vh', opacity: 0 }}
        animate={{ y: -50, opacity: [0, 1, 1, 0] }}
        transition={{
          duration: Math.random() * 3 + 2,
          repeat: Infinity,
          delay: Math.random() * 2,
          ease: "linear",
        }}
      />
    ))}
  </div>
)

export default function Page() {
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content:
        "Welcome to A Siren's Mind.\n\nI guide prompt construction with precision.\n\nWhat would you like to create?",
    },
  ])
  const [isTyping, setIsTyping] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [stackState, setStackState] = useState<StackState>({
    mode: 'SAFE',
    intent: null,
    dna: null,
    vaults: [],
    macros: [],
  })

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSendMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content },
    ])

    const lower = content.toLowerCase()
    if (lower.includes('image') || lower.includes('prompt'))
      setTimeout(() => setStackState((p) => ({ ...p, intent: 'Image Prompt' })), 800)
    if (lower.includes('dna'))
      setTimeout(() => setStackState((p) => ({ ...p, dna: 'Character DNA' })), 1200)
    if (lower.includes('vault'))
      setTimeout(
        () =>
          setStackState((p) => ({
            ...p,
            vaults: [...p.vaults, `Vault ${p.vaults.length + 1}`],
          })),
        1600,
      )
    if (lower.includes('macro'))
      setTimeout(
        () =>
          setStackState((p) => ({
            ...p,
            macros: [...p.macros, `Macro ${p.macros.length + 1}`],
          })),
        1600,
      )

    if (lower.includes('generate')) {
      setShowConfirmation(true)
      return
    }

    setIsTyping(true)
    setTimeout(() => {
      setIsTyping(false)
      setIsStreaming(true)
      setMessages((p) => [
        ...p,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: mockResponses[Math.floor(Math.random() * mockResponses.length)],
          isStreaming: true,
        },
      ])
    }, 900)
  }

  const handleStreamComplete = () => {
    setIsStreaming(false)
    setMessages((p) => p.map((m) => ({ ...m, isStreaming: false })))
  }

  if (!mounted) return null

  return (
    <div className="h-screen bg-black text-white relative overflow-hidden flex">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-pink-900/20" />
        <FloatingParticles />
      </div>

      <div className="flex-1 flex flex-col relative z-10">
        <header className="border-b border-gray-800/50 bg-black/80 backdrop-blur-xl px-6 py-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            A Siren&apos;s Mind
          </h1>
          <p className="text-xs text-gray-400 italic">Erotic Prompt Intelligence</p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 pb-40">
          <div className="max-w-4xl mx-auto">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                isStreaming={m.isStreaming}
                isFirstMessage={i === 0}
                onStreamComplete={handleStreamComplete}
              />
            ))}
            <AnimatePresence>{isTyping && <TypingIndicator />}</AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-black/90 backdrop-blur-xl px-6 py-4">
          <ChatInput onSendMessage={handleSendMessage} disabled={isTyping || isStreaming} />
        </div>
      </div>
    </div>
  )
}
