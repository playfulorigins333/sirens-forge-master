"use client"

import ChatUI from "@/components/chat/ChatUI"
import { useEffect, useState } from "react"

const GENERATOR_MIND_CONTEXT_KEY = "sirensforge:generator_mind_context"
type GenerationTarget = "text_to_image" | "text_to_video" | "image_to_video"
type Context = { version: 1; generation_target: GenerationTarget; prompt?: string; negative_prompt?: string; identity?: string; created_at: number }

export default function SirensMindPage() {
  const [context, setContext] = useState<Context | null | undefined>(undefined)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(GENERATOR_MIND_CONTEXT_KEY)
      window.sessionStorage.removeItem(GENERATOR_MIND_CONTEXT_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const validTarget = ["text_to_image", "text_to_video", "image_to_video"].includes(parsed?.generation_target)
      const fresh = Number.isFinite(parsed?.created_at) && Date.now() - parsed.created_at < 30 * 60 * 1000
      setContext(parsed?.version === 1 && validTarget && fresh ? parsed : null)
    } catch { setContext(null) }
  }, [])
  if (context === undefined) return null
  return <ChatUI initialGenerationTarget={context?.generation_target} initialPrompt={context?.prompt} initialNegativePrompt={context?.negative_prompt} initialIdentity={context?.identity} />
}
