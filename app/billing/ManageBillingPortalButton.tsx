"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"

export function ManageBillingPortalButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || typeof data.url !== "string") {
        throw new Error(data.error || "Could not open billing portal")
      }

      window.location.assign(data.url)
    } catch (err: any) {
      setError(err?.message ?? "Could not open billing portal")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={openPortal}
        disabled={loading}
        className="flex w-full items-center justify-between rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{loading ? "Opening Stripe…" : "Manage billing in Stripe"}</span>
        <ChevronRight className="h-4 w-4" />
      </button>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}
