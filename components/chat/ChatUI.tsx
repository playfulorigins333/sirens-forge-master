"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Shield, Users, Star, X, Check, ChevronDown, ChevronUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { ChatMessage, TypingIndicator } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

type Mode = "SAFE" | "NSFW" | "ULTRA"

interface Message {
  id: string
  role: "assistant" | "user"
  content: string
  isStreaming?: boolean
  isError?: boolean
}

type VaultId =
  | "composition_framing_ultra"
  | "lighting_environment_fx"
  | "camera_style_lens_fx"
  | "color_tone_mood"
  | "breasts_chest_upper"
  | "legs_thighs_hips"
  | "position_restraint_bondage"
  | "face_mouth_expressions"
  | "eyes_gaze_emotion"
  | "skin_sweat_marks_texture"
  | "public_risk_exhibition_ultra"
  | "private_intimacy_soft"
  | "anal_ass_tail_ultra"
  | "oral_throat_mouth_play"
  | "fluid_mess_aftermath"
  | "domination_control"
  | "submission_obedience"
  | "praise_degradation_mindplay"
  | "ritual_ceremony_symbolism"
  | "hands_fingers_nails_ultra"
  | "multi_partner_orgy_cuckoldry_ultra"
  | "partner_interaction_power_exchange"
  | "voyeur_filming_performance"
  | "audience_crowd_exposure"
  | "clothing_lingerie_accessories"
  | "latex_leather_fetishwear"
  | "roleplay_fantasy_costume_ultra"
  | "smell_sweat_pheromones_ultra"
  | "pain_endurance_threshold"
  | "ultra_extremes_no_limits"

type VaultCategory =
  | "visual"
  | "body"
  | "context"
  | "psychology"
  | "multi"
  | "style"
  | "sensory"
  | "system"

type VaultDef = {
  id: VaultId
  label: string
  minMode: Mode
  category: VaultCategory
  description?: string
}

type InferredIntent = "image" | "story" | "batch" | "explore"

type HeadlessSuccess = {
  status: "ok"
  mode: string
  model: string
  result: {
    prompt: string
    negative_prompt?: string
    tags?: string[]
    style?: string
    metadata?: Record<string, any>
  }
}

type HeadlessRefusal = {
  status?: "refused"
  error_code: string
  reason: string
}

/**
 * Vault registry (UI-side)
 * - ids are stable + used in the API payload as vault_ids
 * - labels are UI-friendly
 * - minMode controls availability by Session Mode
 * - category powers suggestions
 */
const VAULTS: VaultDef[] = [
  // 🎥 Core Visual / Structural
  { id: "composition_framing_ultra", label: "Composition & Framing Ultra", minMode: "SAFE", category: "visual" },
  { id: "lighting_environment_fx", label: "Lighting & Environmental Effects", minMode: "SAFE", category: "visual" },
  { id: "camera_style_lens_fx", label: "Camera Style & Lens Effects", minMode: "SAFE", category: "visual" },
  { id: "color_tone_mood", label: "Color, Tone & Visual Mood", minMode: "SAFE", category: "visual" },

  // 🧍 Body-Focused
  { id: "breasts_chest_upper", label: "Breasts, Chest & Upper Body", minMode: "NSFW", category: "body" },
  { id: "legs_thighs_hips", label: "Legs, Thighs & Hips", minMode: "NSFW", category: "body" },
  { id: "position_restraint_bondage", label: "Position, Restraint & Bondage", minMode: "NSFW", category: "body" },
  { id: "face_mouth_expressions", label: "Face, Mouth & Expressions", minMode: "SAFE", category: "body" },
  { id: "eyes_gaze_emotion", label: "Eyes, Gaze & Emotion", minMode: "SAFE", category: "body" },
  { id: "skin_sweat_marks_texture", label: "Skin, Sweat, Marks & Texture", minMode: "NSFW", category: "body" },

  // 🌍 Context & Scenario
  { id: "public_risk_exhibition_ultra", label: "Public Risk & Exhibition Ultra", minMode: "ULTRA", category: "context" },
  { id: "private_intimacy_soft", label: "Private Intimacy & Soft Scenes", minMode: "SAFE", category: "context" },
  { id: "anal_ass_tail_ultra", label: "Anal, Ass & Tail Ultra", minMode: "ULTRA", category: "context" },
  { id: "oral_throat_mouth_play", label: "Oral, Throat & Mouth Play", minMode: "NSFW", category: "context" },
  { id: "fluid_mess_aftermath", label: "Fluid, Mess & Aftermath", minMode: "ULTRA", category: "context" },

  // 🧠 Psychological / Power Dynamics
  { id: "domination_control", label: "Domination & Control", minMode: "ULTRA", category: "psychology" },
  { id: "submission_obedience", label: "Submission & Obedience", minMode: "ULTRA", category: "psychology" },
  { id: "praise_degradation_mindplay", label: "Praise, Degradation & Mindplay", minMode: "ULTRA", category: "psychology" },
  { id: "ritual_ceremony_symbolism", label: "Ritual, Ceremony & Symbolism", minMode: "NSFW", category: "psychology" },
  { id: "hands_fingers_nails_ultra", label: "Hands, Fingers & Nails Ultra", minMode: "NSFW", category: "psychology" },

  // 👥 Multi-Person / Advanced Dynamics
  {
    id: "multi_partner_orgy_cuckoldry_ultra",
    label: "Multi-Partner, Orgy & Cuckoldry Ultra",
    minMode: "ULTRA",
    category: "multi",
  },
  {
    id: "partner_interaction_power_exchange",
    label: "Partner Interaction & Power Exchange",
    minMode: "NSFW",
    category: "multi",
  },
  { id: "voyeur_filming_performance", label: "Voyeur, Filming & Performance", minMode: "ULTRA", category: "multi" },
  { id: "audience_crowd_exposure", label: "Audience, Crowd & Exposure", minMode: "ULTRA", category: "multi" },

  // 🧥 Style, Clothing & Identity
  { id: "clothing_lingerie_accessories", label: "Clothing, Lingerie & Accessories", minMode: "SAFE", category: "style" },
  { id: "latex_leather_fetishwear", label: "Latex, Leather & Fetishwear", minMode: "NSFW", category: "style" },
  { id: "roleplay_fantasy_costume_ultra", label: "Roleplay, Fantasy & Costume Ultra", minMode: "ULTRA", category: "style" },

  // 🧪 Sensory & Physical Intensity
  {
    id: "smell_sweat_pheromones_ultra",
    label: "Smell, Sweat & Pheromones Ultra",
    minMode: "ULTRA",
    category: "sensory",
  },
  { id: "pain_endurance_threshold", label: "Pain, Endurance & Threshold", minMode: "ULTRA", category: "sensory" },
  { id: "ultra_extremes_no_limits", label: "Ultra Extremes / No-Limits Layer", minMode: "ULTRA", category: "system" },
]

function isModeAllowed(current: Mode, minMode: Mode) {
  const rank = (m: Mode) => (m === "SAFE" ? 0 : m === "NSFW" ? 1 : 2)
  return rank(current) >= rank(minMode)
}

// Lightweight intent inference (start simple; refine later)
function inferIntent(input: string): { intent: InferredIntent; confidence: number } {
  const s = (input || "").toLowerCase()
  const has = (w: string) => s.includes(w)
  const hits: Array<{ intent: InferredIntent; score: number }> = [
    { intent: "batch", score: ["batch", "pack", "set of", "variants", "10 prompts", "20 prompts"].some(has) ? 2 : 0 },
    { intent: "story", score: ["story", "scene", "narrative", "plot", "chapter"].some(has) ? 2 : 0 },
    { intent: "image", score: ["image", "photo", "prompt", "shot", "cinematic", "portrait"].some(has) ? 2 : 0 },
  ]

  const top = hits.sort((a, b) => b.score - a.score)[0]
  if (!top || top.score === 0) return { intent: "explore", confidence: 0.35 }
  return { intent: top.intent, confidence: Math.min(0.95, 0.55 + top.score * 0.2) }
}

function suggestVaults(params: {
  mode: Mode
  inferredIntent: InferredIntent
  activeVaultIds: VaultId[]
  allVaults: VaultDef[]
}) {
  const { mode, inferredIntent, activeVaultIds, allVaults } = params

  const intentCategories: Record<InferredIntent, VaultCategory[]> = {
    image: ["visual", "style", "body"],
    story: ["context", "psychology", "style"],
    batch: ["visual", "style", "context"],
    explore: ["visual", "context", "style", "psychology", "body", "multi"],
  }

  const preferred = new Set(intentCategories[inferredIntent] || intentCategories.explore)

  // Minimal synergy starters (expand later)
  const SYNERGY: Partial<Record<VaultId, VaultId[]>> = {
    roleplay_fantasy_costume_ultra: ["lighting_environment_fx", "composition_framing_ultra", "partner_interaction_power_exchange"],
    public_risk_exhibition_ultra: ["voyeur_filming_performance", "audience_crowd_exposure", "lighting_environment_fx"],
    domination_control: ["hands_fingers_nails_ultra", "submission_obedience"],
  }

  const active = new Set<VaultId>(activeVaultIds)

  const candidates = allVaults
    .filter((v) => isModeAllowed(mode, v.minMode))
    .filter((v) => !active.has(v.id))

  const scored = candidates
    .map((v) => {
      let score = 0

      if (preferred.has(v.category)) score += 3

      for (const a of activeVaultIds) {
        const syn = SYNERGY[a] || []
        if (syn.includes(v.id)) score += 4
      }

      // small boost to foundational vaults
      if (["composition_framing_ultra", "lighting_environment_fx", "camera_style_lens_fx", "color_tone_mood"].includes(v.id)) score += 1

      return { v, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, 5).map((x) => x.v)
}

interface StackState {
  mode: Mode
  intent: string | null
  dna: string | null
  vault_ids: VaultId[]
  macros: string[]
}

const FloatingParticles = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(30)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-purple-400 rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            filter: "blur(1px)",
          }}
          initial={{
            y: "100vh",
            opacity: 0,
          }}
          animate={{
            y: -50,
            opacity: [0, 1, 1, 0],
          }}
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
}

export const ChatUI: React.FC = () => {
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Welcome to A Siren's Mind.\n\nI guide prompt construction with precision.\n\nWhat would you like to create?",
      isStreaming: false,
    },
  ])
  const [isTyping, setIsTyping] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [vaultPanelOpen, setVaultPanelOpen] = useState(true)

  // Stack state
  const [stackState, setStackState] = useState<StackState>({
    mode: "SAFE",
    intent: null,
    dna: null,
    vault_ids: [],
    macros: [],
  })

  // Session-state helpers (intent inference + vault suggestions)
  const [inferredIntent, setInferredIntent] = useState<InferredIntent>("explore")
  const [intentConfidence, setIntentConfidence] = useState<number>(0.35)

  const vaultRegistry: VaultDef[] = useMemo(() => VAULTS, [])

  const suggestedVaults = useMemo(() => {
    return suggestVaults({
      mode: stackState.mode,
      inferredIntent,
      activeVaultIds: stackState.vault_ids,
      allVaults: vaultRegistry,
    })
  }, [stackState.mode, stackState.vault_ids, inferredIntent, vaultRegistry])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const allowedVaults = useMemo(() => {
    return VAULTS.filter((v) => isModeAllowed(stackState.mode, v.minMode))
  }, [stackState.mode])

  const selectedVaultLabels = useMemo(() => {
    const byId = new Map<VaultId, string>(VAULTS.map((v) => [v.id, v.label]))
    return stackState.vault_ids.map((id) => byId.get(id) ?? id)
  }, [stackState.vault_ids])

  const toggleVault = (id: VaultId) => {
    setStackState((prev) => {
      const exists = prev.vault_ids.includes(id)
      const next = exists ? prev.vault_ids.filter((x) => x !== id) : [...prev.vault_ids, id]
      // keep order stable by VAULTS list
      const order = new Map<VaultId, number>(VAULTS.map((v, i) => [v.id, i]))
      next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      return { ...prev, vault_ids: next }
    })
  }

  // If user drops mode, enforce vault availability immediately (no server errors)
  useEffect(() => {
    setStackState((prev) => {
      const filtered = prev.vault_ids.filter((id) => {
        const def = VAULTS.find((v) => v.id === id)
        return def ? isModeAllowed(prev.mode, def.minMode) : false
      })
      if (filtered.length === prev.vault_ids.length) return prev
      return { ...prev, vault_ids: filtered }
    })
  }, [stackState.mode])

  const handleSendMessage = async (content: string) => {
    const trimmed = content?.trim()
    if (!trimmed) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    }

    setMessages((prev) => [...prev, userMessage])

    // 🔥 Maintain session state like ChatGPT: infer intent every message (soft, no nagging)
    const inf = inferIntent(trimmed)
    setInferredIntent(inf.intent)
    setIntentConfidence(inf.confidence)

    // Simulated stack updates (visual only)
    const lowerMessage = trimmed.toLowerCase()
    if (lowerMessage.includes("image") || lowerMessage.includes("prompt")) {
      setTimeout(() => setStackState((prev) => ({ ...prev, intent: "Image Prompt" })), 350)
    }
    if (lowerMessage.includes("character") || lowerMessage.includes("dna")) {
      setTimeout(() => setStackState((prev) => ({ ...prev, dna: "Character DNA" })), 550)
    }
    if (lowerMessage.includes("vault")) {
      setTimeout(() => setVaultPanelOpen(true), 250)
    }
    if (lowerMessage.includes("macro")) {
      setTimeout(() => setStackState((prev) => ({ ...prev, macros: [...prev.macros, `Macro ${prev.macros.length + 1}`] })), 600)
    }

    // UI-only confirmation path (no generator auto-run)
    if (lowerMessage.includes("generate") || lowerMessage.includes("create")) {
      setTimeout(() => setShowConfirmation(true), 400)
      return
    }

    setIsTyping(true)

    try {
      const intentToSend =
        stackState.intent && stackState.intent.toLowerCase().includes("image") ? "image_prompt" : stackState.intent || "image_prompt"

      const payload = {
        mode: stackState.mode,
        intent: intentToSend,
        output_format: "plain",
        dna_decision: "none",
        stack_depth: "light",
        description: trimmed,
        // ✅ vault wiring
        vault_ids: stackState.vault_ids,
      }

      const res = await fetch("/api/nsfw-gpt/headless", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = (await res.json()) as HeadlessSuccess | HeadlessRefusal

      setIsTyping(false)
      setIsStreaming(true)

      await new Promise((r) => setTimeout(r, 250))

      let assistantText = ""
      let isError = false

      if ((data as HeadlessRefusal).error_code) {
        const refused = data as HeadlessRefusal
        assistantText = `${refused.error_code}: ${refused.reason}`
        isError = true
      } else {
        const ok = data as HeadlessSuccess
        assistantText = ok?.result?.prompt ?? "SYSTEM_ERROR: Missing result.prompt"
        if (!ok?.result?.prompt) isError = true
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantText,
        isStreaming: true,
        isError,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch {
      setIsTyping(false)
      setIsStreaming(true)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "SYSTEM_ERROR: Failed to reach /api/nsfw-gpt/headless",
        isStreaming: true,
        isError: true,
      }

      setMessages((prev) => [...prev, assistantMessage])
    }
  }

  const handleStreamComplete = () => {
    setIsStreaming(false)
    setMessages((prev) => prev.map((msg) => ({ ...msg, isStreaming: false })))
  }

  const handleModeChange = (mode: Mode) => {
    setStackState((prev) => ({ ...prev, mode }))
  }

  const handleConfirmGeneration = () => {
    setShowConfirmation(false)
    setIsTyping(true)

    setTimeout(() => {
      setIsTyping(false)
      setIsStreaming(true)

      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: "Generation confirmed. Your prompt has been queued.\n\nI'll notify you when it's ready.",
        isStreaming: true,
      }

      setMessages((prev) => [...prev, assistantMessage])
    }, 800)
  }

  const getModeColor = (m: Mode) => {
    switch (m) {
      case "SAFE":
        return "from-emerald-500 to-green-500"
      case "NSFW":
        return "from-amber-500 to-orange-500"
      case "ULTRA":
        return "from-rose-600 via-amber-500 to-red-600"
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

  if (!mounted) return null

  return (
    <div className="h-screen bg-black text-white relative overflow-hidden flex">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-pink-900/20" />
        <FloatingParticles />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative z-10">
        {/* Header with Mode Selector */}
        <header className="border-b border-gray-800/50 bg-black/80 backdrop-blur-xl">
          <div className="px-4 md:px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <motion.h1
                  className="text-xl md:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"
                  animate={{
                    backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                  }}
                  transition={{ duration: 5, repeat: Infinity }}
                  style={{ backgroundSize: "200% 200%" }}
                >
                  A Siren&apos;s Mind
                </motion.h1>
                <p className="text-xs text-gray-400 italic mt-1">Erotic Prompt Intelligence</p>
              </div>
            </div>

            {/* Global Mode Selector */}
            <div className="bg-gray-900/50 rounded-lg p-2 inline-flex items-center gap-3">
              <span className="text-xs text-gray-400 font-bold uppercase tracking-wider pl-2">Session Mode:</span>
              <div className="flex gap-2">
                {(["SAFE", "NSFW", "ULTRA"] as Mode[]).map((m) => {
                  const Icon = getModeIcon(m)
                  const isActive = stackState.mode === m
                  const isUltra = m === "ULTRA"

                  return (
                    <motion.button
                      key={m}
                      onClick={() => handleModeChange(m)}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.95 }}
                      className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 ${
                        isActive
                          ? `bg-gradient-to-r ${getModeColor(m)} text-white ${
                              isUltra ? "shadow-xl shadow-rose-500/50 ring-2 ring-rose-400/50" : "shadow-lg"
                            }`
                          : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:shadow-md"
                      }`}
                      animate={
                        isActive && isUltra
                          ? {
                              boxShadow: [
                                "0 0 20px rgba(244, 63, 94, 0.5)",
                                "0 0 30px rgba(244, 63, 94, 0.7)",
                                "0 0 20px rgba(244, 63, 94, 0.5)",
                              ],
                            }
                          : {}
                      }
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Icon className={`${isUltra && isActive ? "w-4 h-4" : "w-3 h-3"}`} />
                      {m}
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </div>
        </header>

        {/* Chat Stream */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-48 sm:pb-44 md:pb-44">
          <div className="max-w-4xl mx-auto">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                isStreaming={message.isStreaming}
                onStreamComplete={handleStreamComplete}
                isFirstMessage={index === 0 && message.role === "assistant"}
              />
            ))}

            <AnimatePresence>{isTyping && <TypingIndicator />}</AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Fixed Input Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 md:right-80 border-t border-gray-800/50 bg-black/90 backdrop-blur-xl z-50"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-4">
            <ChatInput onSendMessage={handleSendMessage} disabled={isTyping || isStreaming} />
            <p className="text-xs text-gray-500 mt-2 text-center">Press Enter to send • Shift+Enter for new line</p>
          </div>
        </div>
      </div>

      {/* Live Stack Sidebar */}
      <aside className="hidden md:block w-80 border-l border-gray-800/50 bg-black/80 backdrop-blur-xl relative z-10 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-4">
              Current Stack
            </h2>
            <div className="text-xs text-gray-500 mb-4">Live session state</div>
          </div>

          {/* Mode Display */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Mode</div>
            <motion.div
              key={stackState.mode}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`px-4 py-2 rounded-lg bg-gradient-to-r ${getModeColor(stackState.mode)} text-white font-semibold text-sm flex items-center gap-2 ${
                stackState.mode === "ULTRA" ? "shadow-lg shadow-rose-500/50" : ""
              }`}
            >
              {React.createElement(getModeIcon(stackState.mode), { className: "w-4 h-4" })}
              {stackState.mode}
            </motion.div>
          </div>

          {/* Intent */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Intent</div>
            <AnimatePresence mode="wait">
              {stackState.intent ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/50 text-purple-300 text-sm break-words"
                >
                  {stackState.intent}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-4 py-2 rounded-lg border border-dashed border-gray-700 text-gray-600 text-sm italic"
                >
                  Not set
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* DNA */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">DNA</div>
            <AnimatePresence mode="wait">
              {stackState.dna ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 text-sm break-words"
                >
                  {stackState.dna}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-4 py-2 rounded-lg border border-dashed border-gray-700 text-gray-600 text-sm italic"
                >
                  Not set
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Vaults */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setVaultPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="text-xs text-gray-500 uppercase tracking-wider">
                Vaults ({stackState.vault_ids.length})
              </div>
              {vaultPanelOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>

            <AnimatePresence initial={false}>
              {vaultPanelOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-2"
                >
                  <div className="text-[11px] text-gray-400">
                    Choose vaults to stack into the prompt brain. Availability follows Session Mode.
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-gray-300">
                        Suggested vaults (based on your message • {inferredIntent.toUpperCase()} • {(intentConfidence * 100).toFixed(0)}%
                        confidence)
                      </div>
                      <button
                        type="button"
                        onClick={() => setVaultPanelOpen(true)}
                        className="text-[11px] text-purple-300 hover:text-purple-200"
                      >
                        Advanced
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {suggestedVaults.length === 0 ? (
                        <span className="text-[11px] text-gray-500">No suggestions yet — start describing a scene.</span>
                      ) : (
                        suggestedVaults.map((v) => {
                          const active = stackState.vault_ids.includes(v.id)
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => toggleVault(v.id)}
                              className={`px-3 py-1.5 rounded-full text-[11px] border transition-all ${
                                active
                                  ? "bg-purple-500/20 border-purple-500/40 text-purple-200"
                                  : "bg-gray-900 border-gray-800 text-gray-200 hover:border-gray-700"
                              }`}
                            >
                              {active ? "✓ " : "+ "}
                              {v.label}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto pr-1 space-y-1">
                    {allowedVaults.map((v) => {
                      const checked = stackState.vault_ids.includes(v.id)
                      return (
                        <label
                          key={v.id}
                          className="flex items-start gap-2 px-3 py-2 rounded bg-gray-950/60 border border-gray-800 hover:border-gray-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleVault(v.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <div className="text-sm text-gray-200 leading-tight">{v.label}</div>
                            <div className="text-[10px] text-gray-500 leading-tight mt-0.5">{v.id}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  {stackState.vault_ids.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider">Selected</div>
                      <div className="space-y-1">
                        {selectedVaultLabels.map((label, i) => (
                          <div key={i} className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-sm break-words">
                            {label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {stackState.vault_ids.length === 0 && (
                    <div className="px-4 py-2 rounded-lg border border-dashed border-gray-700 text-gray-600 text-sm italic">
                      None selected
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Macros */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Macros ({stackState.macros.length})</div>
            {stackState.macros.length > 0 ? (
              <div className="space-y-2">
                {stackState.macros.map((macro, i) => (
                  <motion.div
                    key={i}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1 }}
                    className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-sm break-words"
                  >
                    {macro}
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-2 rounded-lg border border-dashed border-gray-700 text-gray-600 text-sm italic">
                None selected
              </div>
            )}
          </div>

          {/* Progress Indicator */}
          <div className="pt-6 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Completion</span>
              <span className="text-sm font-bold text-purple-400">
                {Math.round(([stackState.mode, stackState.intent, stackState.dna].filter(Boolean).length / 3) * 100)}%
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"
                initial={{ width: 0 }}
                animate={{
                  width: `${([stackState.mode, stackState.intent, stackState.dna].filter(Boolean).length / 3) * 100}%`,
                }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowConfirmation(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Confirm Generation
              </h3>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center py-2 border-b border-gray-800">
                  <span className="text-sm text-gray-400">Mode</span>
                  <span
                    className={`text-sm font-semibold bg-gradient-to-r ${getModeColor(stackState.mode)} bg-clip-text text-transparent`}
                  >
                    {stackState.mode}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-800">
                  <span className="text-sm text-gray-400">Intent</span>
                  <span className="text-sm text-white break-words">{stackState.intent || "Not set"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-800">
                  <span className="text-sm text-gray-400">DNA</span>
                  <span className="text-sm text-white break-words">{stackState.dna || "Not set"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-800">
                  <span className="text-sm text-gray-400">Vaults</span>
                  <span className="text-sm text-white">{stackState.vault_ids.length}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-400">Macros</span>
                  <span className="text-sm text-white">{stackState.macros.length}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={() => setShowConfirmation(false)} variant="outline" className="flex-1 border-gray-700 hover:bg-gray-800">
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleConfirmGeneration} className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500">
                  <Check className="w-4 h-4 mr-2" />
                  Confirm
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// END OF FILE
