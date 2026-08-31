"use client"

import ChatUI from "@/components/chat/ChatUI"
import { useEffect, useState } from "react"

const GENERATOR_MIND_CONTEXT_KEY = "sirensforge:generator_mind_context"
type GenerationTarget = "text_to_image" | "text_to_video" | "image_to_video"
type Context = { version: 1; generation_target: GenerationTarget; prompt?: string; negative_prompt?: string; identity?: string; source_generation_asset_id?: string; created_at: number }

function canonicalUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed.toLowerCase()
    : undefined
}

export default function SirensMindPage() {
  const [context, setContext] = useState<Context | null | undefined>(undefined)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(GENERATOR_MIND_CONTEXT_KEY)
      window.sessionStorage.removeItem(GENERATOR_MIND_CONTEXT_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const validTarget = ["text_to_image", "text_to_video", "image_to_video"].includes(parsed?.generation_target)
      const fresh = Number.isFinite(parsed?.created_at) && Date.now() - parsed.created_at < 30 * 60 * 1000
      if (parsed?.version === 1 && validTarget && fresh) {
        const sourceGenerationAssetId = parsed.generation_target === "image_to_video"
          ? canonicalUuid(parsed.source_generation_asset_id)
          : undefined
        const prompt = typeof parsed.prompt === "string" && parsed.prompt.length <= 8000
          ? parsed.prompt
          : undefined
        const negativePrompt = typeof parsed.negative_prompt === "string" && parsed.negative_prompt.length <= 8000
          ? parsed.negative_prompt
          : undefined
        const identity = canonicalUuid(parsed.identity)
        setContext({
          version: 1,
          generation_target: parsed.generation_target,
          ...(prompt !== undefined ? { prompt } : {}),
          ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
          ...(identity ? { identity } : {}),
          ...(sourceGenerationAssetId ? { source_generation_asset_id: sourceGenerationAssetId } : {}),
          created_at: parsed.created_at,
        })
      } else {
        setContext(null)
      }
    } catch { setContext(null) }
  }, [])
  if (context === undefined) return null
  return <ChatUI initialGenerationTarget={context?.generation_target} initialPrompt={context?.prompt} initialNegativePrompt={context?.negative_prompt} initialIdentity={context?.identity} initialSourceGenerationAssetId={context?.source_generation_asset_id} />
}
