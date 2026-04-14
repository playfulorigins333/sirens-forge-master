"use client"

import { Button } from "@/components/ui/button"
import {
  Download,
  Copy,
  Sparkles,
  UserPlus,
} from "lucide-react"

type Props = {
  imageUrl: string
  prompt: string
  onRegenerate: () => void
}

export default function PostGenActions({
  imageUrl,
  prompt,
  onRegenerate,
}: Props) {
  function handleDownload() {
    const link = document.createElement("a")
    link.href = imageUrl
    link.download = "sirens-forge-image.png"
    link.click()
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(prompt)
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <h3 className="mb-4 text-lg font-semibold text-white">
        Next Actions
      </h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button
          onClick={handleDownload}
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download
        </Button>

        <Button
          variant="secondary"
          onClick={handleCopyPrompt}
          className="flex items-center gap-2"
        >
          <Copy className="w-4 h-4" />
          Copy Prompt
        </Button>

        <Button
          variant="secondary"
          onClick={onRegenerate}
          className="flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          Generate More
        </Button>

        <Button
          variant="secondary"
          onClick={() => (window.location.href = "/lora/train")}
          className="flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Train AI Twin
        </Button>
      </div>
    </div>
  )
}