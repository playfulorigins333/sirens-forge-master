"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sparkles,
  Check,
  X,
  Clock,
  AlertCircle,
  CheckCircle,
  Crown,
  Zap,
  Shield,
  ChevronRight,
  Settings,
  ExternalLink,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

// -----------------------------
// Types
// -----------------------------
type PlatformId =
  | "fanvue"
  | "onlyfans"
  | "fansly"
  | "loyalfans"
  | "justforfans"
  | "x"
  | "reddit"

type PlatformStatus = "live" | "ready" | "coming_soon"
type PreviewStatus = "ready" | "partial" | "blocked"

type Platform = {
  id: PlatformId
  name: string
  status: PlatformStatus
  connected: boolean
  // Capabilities (we use these to enforce safe, production behavior)
  supports_hashtags: boolean
  supports_cta: boolean
  max_explicitness_cap: number // hard cap per platform (UI-level gate)
  notes?: string
}

type AutopostPreviewPayload = {
  caption_text: string | null
  cta_text: string | null
  hashtags: string[] | null
  platform: PlatformId
  revenue: {
    creator_pct: number
    platform_pct: number
  }
}

type AutopostDiagnostics = {
  platform: PlatformId
  timestamp: string
  state: "READY" | "PARTIAL_READY" | "BLOCKED"
  reason?: string
  caption?: any
  cta?: any
  hashtags?: any
}

type AutopostPreviewResponse = {
  state: "READY" | "PARTIAL_READY" | "BLOCKED"
  reason?: string
  payload?: AutopostPreviewPayload
  diagnostics?: AutopostDiagnostics
}

// -----------------------------
// Floating particles background
// -----------------------------
const FloatingParticles = () => {
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 })

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    })
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-purple-400 rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            filter: "blur(1px)",
          }}
          initial={{
            y: dimensions.height + 10,
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

// -----------------------------
// Launch-safe defaults (used if /api/autopost/platforms is not wired yet)
// IMPORTANT: X + Reddit are included and treated as launch-ready (connection required).
// -----------------------------
const FALLBACK_PLATFORMS: Platform[] = [
  {
    id: "fanvue",
    name: "Fanvue",
    status: "live",
    connected: true,
    supports_hashtags: false,
    supports_cta: false,
    max_explicitness_cap: 5,
    notes: "Fully supported at launch.",
  },
  {
    id: "onlyfans",
    name: "OnlyFans",
    status: "ready",
    connected: false,
    supports_hashtags: false,
    supports_cta: false,
    max_explicitness_cap: 5,
    notes: "Connection required.",
  },
  {
    id: "fansly",
    name: "Fansly",
    status: "ready",
    connected: false,
    supports_hashtags: true,
    supports_cta: true,
    max_explicitness_cap: 5,
    notes: "Connection required.",
  },
  {
    id: "loyalfans",
    name: "LoyalFans",
    status: "ready",
    connected: false,
    supports_hashtags: true,
    supports_cta: true,
    max_explicitness_cap: 5,
    notes: "Connection required.",
  },
  {
    id: "justforfans",
    name: "JustForFans",
    status: "ready",
    connected: false,
    supports_hashtags: true,
    supports_cta: true,
    max_explicitness_cap: 5,
    notes: "Connection required.",
  },
  {
    id: "x",
    name: "X (Twitter)",
    status: "ready",
    connected: false,
    supports_hashtags: true,
    supports_cta: false,
    // Hard launch rule: keep explicitness conservative for public platforms
    max_explicitness_cap: 2,
    notes: "Public platform: teaser-only recommended.",
  },
  {
    id: "reddit",
    name: "Reddit",
    status: "ready",
    connected: false,
    supports_hashtags: false,
    supports_cta: false,
    max_explicitness_cap: 2,
    notes: "Public platform: teaser-only recommended.",
  },
]

const toneOptions = ["Playful", "Teasing", "Confident", "Soft", "Dominant"] as const

// -----------------------------
// API helpers (production wiring)
// -----------------------------
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchPlatforms(): Promise<Platform[] | null> {
  // If you later add a real API, this will automatically start using it.
  // Expected response: { platforms: Platform[] }
  try {
    const res = await fetch("/api/autopost/platforms", { method: "GET" })
    if (!res.ok) return null
    const data = await safeJson<{ platforms: Platform[] }>(res)
    if (!data?.platforms?.length) return null
    return data.platforms
  } catch {
    return null
  }
}

async function startConnectFlow(platform: PlatformId): Promise<{ redirectUrl?: string } | null> {
  // Expected response: { url: string }
  try {
    const res = await fetch(`/api/autopost/connect?platform=${encodeURIComponent(platform)}`, {
      method: "GET",
    })
    if (!res.ok) return null
    const data = await safeJson<{ redirectUrl?: string }>(res)
    return data
  } catch {
    return null
  }
}

async function runPreviewSelection(input: {
  enabled: boolean
  selected_platforms: PlatformId[]
  explicitness: number
  tones: string[]
  frequency: string
}): Promise<AutopostPreviewResponse | null> {
  // Expected response (matches your local tests): { state, payload, diagnostics, reason }
  try {
    const res = await fetch("/api/autopost/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!res.ok) return null
    const data = await safeJson<AutopostPreviewResponse>(res)
    return data
  } catch {
    return null
  }
}

// -----------------------------
// Component
// -----------------------------
export default function AutopostPage() {
  const [mounted, setMounted] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Server-backed state (with safe fallback)
  const [platforms, setPlatforms] = useState<Platform[]>(FALLBACK_PLATFORMS)

  // Config state
  const [enabled, setEnabled] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>(["fanvue"])
  const [frequency, setFrequency] = useState("manual")
  const [explicitness, setExplicitness] = useState(3)
  const [selectedTones, setSelectedTones] = useState<string[]>(["Playful", "Teasing"])

  // Preview state
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("blocked")
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [previewResult, setPreviewResult] = useState<AutopostPreviewResponse | null>(null)

  // Modals
  const [showWhyBlockedModal, setShowWhyBlockedModal] = useState(false)
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [selectedPlatformForConnection, setSelectedPlatformForConnection] = useState<PlatformId | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [mounted])

  // Load platforms from server if available
  useEffect(() => {
    if (!mounted) return
    ;(async () => {
      const serverPlatforms = await fetchPlatforms()
      if (serverPlatforms?.length) {
        setPlatforms(serverPlatforms)

        // Keep selection valid if server returns different availability
        const connectedIds = new Set(serverPlatforms.filter(p => p.connected).map(p => p.id))
        setSelectedPlatforms(prev => prev.filter(id => connectedIds.has(id) || id === "fanvue"))
      }
    })()
  }, [mounted])

  const platformById = useMemo(() => {
    const map = new Map<PlatformId, Platform>()
    platforms.forEach(p => map.set(p.id, p))
    return map
  }, [platforms])

  // Enforce per-platform explicitness caps (production safety)
  const effectiveExplicitnessCap = useMemo(() => {
    if (!selectedPlatforms.length) return 1
    let cap = 5
    for (const pid of selectedPlatforms) {
      const p = platformById.get(pid)
      if (p) cap = Math.min(cap, p.max_explicitness_cap)
    }
    return cap
  }, [selectedPlatforms, platformById])

  useEffect(() => {
    if (explicitness > effectiveExplicitnessCap) {
      setExplicitness(effectiveExplicitnessCap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveExplicitnessCap])

  // Preview status logic (launch behavior)
  useEffect(() => {
    if (!enabled) {
      setPreviewStatus("blocked")
      setPreviewResult(null)
      setShowDiagnostics(false)
      return
    }
    if (enabled && selectedPlatforms.length > 0) {
      // Until a preview is run, we’re “partial” (meaning: enabled/configured but not evaluated)
      setPreviewStatus("partial")
    } else {
      setPreviewStatus("blocked")
    }
  }, [enabled, selectedPlatforms])

  const togglePlatform = (platformId: PlatformId) => {
    const platform = platformById.get(platformId)
    if (!platform) return

    // If platform is ready but not connected, open connect flow
    if (!platform.connected && platform.status !== "coming_soon") {
      setSelectedPlatformForConnection(platformId)
      setShowConnectionModal(true)
      return
    }

    // Toggle selection only if connected
    if (platform.connected) {
      setSelectedPlatforms(prev => {
        if (prev.includes(platformId)) return prev.filter(p => p !== platformId)
        return [...prev, platformId]
      })
    }
  }

  const toggleTone = (tone: string) => {
    setSelectedTones(prev => (prev.includes(tone) ? prev.filter(t => t !== tone) : [...prev, tone]))
  }

  const handlePreviewSelection = async () => {
    setIsEvaluating(true)
    setShowDiagnostics(false)

    // Production: call the API
    const apiResult = await runPreviewSelection({
      enabled,
      selected_platforms: selectedPlatforms,
      explicitness,
      tones: selectedTones,
      frequency,
    })

    if (apiResult) {
      setPreviewResult(apiResult)

      if (apiResult.state === "READY") setPreviewStatus("ready")
      else if (apiResult.state === "PARTIAL_READY") setPreviewStatus("partial")
      else setPreviewStatus("blocked")

      setShowDiagnostics(true)
      setIsEvaluating(false)
      return
    }

    // Fallback (should rarely happen in production; prevents dead UI)
    const firstPlatform = selectedPlatforms[0] ?? "fanvue"
    const fallback: AutopostPreviewResponse = {
      state: "PARTIAL_READY",
      payload: {
        caption_text: "Who wants a private show?",
        cta_text: null,
        hashtags: null,
        platform: firstPlatform,
        revenue: { creator_pct: 80, platform_pct: 20 },
      },
      diagnostics: {
        platform: firstPlatform,
        timestamp: new Date().toISOString(),
        state: "PARTIAL_READY",
        reason: "FALLBACK_PREVIEW",
      },
    }

    setPreviewResult(fallback)
    setPreviewStatus("partial")
    setShowDiagnostics(true)
    setIsEvaluating(false)
  }

  const getStatusColor = () => {
    switch (previewStatus) {
      case "ready":
        return "from-emerald-500 to-green-500"
      case "partial":
        return "from-amber-500 to-orange-500"
      case "blocked":
        return "from-rose-500 to-red-500"
    }
  }

  const getStatusIcon = () => {
    switch (previewStatus) {
      case "ready":
        return CheckCircle
      case "partial":
        return AlertCircle
      case "blocked":
        return X
    }
  }

  const getStatusText = () => {
    switch (previewStatus) {
      case "ready":
        return "Autopost Ready"
      case "partial":
        return "Configured (Run Preview)"
      case "blocked":
        return "Autopost Blocked"
    }
  }

  const selectedPlatformNames = useMemo(() => {
    return selectedPlatforms
      .map(id => platformById.get(id)?.name)
      .filter(Boolean)
      .join(", ")
  }, [selectedPlatforms, platformById])

  const connectedCount = useMemo(() => platforms.filter(p => p.connected).length, [platforms])

  const previewPayload = previewResult?.payload
  const previewDiagnostics = previewResult?.diagnostics

  const canScheduleNow = false // Phase 3 per your plan

  const publicPlatformSelected = useMemo(() => {
    return selectedPlatforms.includes("x") || selectedPlatforms.includes("reddit")
  }, [selectedPlatforms])

  const connectModalPlatform = selectedPlatformForConnection ? platformById.get(selectedPlatformForConnection) : null

  const handleConnect = async () => {
    if (!selectedPlatformForConnection) return
    setIsConnecting(true)

    const data = await startConnectFlow(selectedPlatformForConnection)

    // If backend provides a URL, send them to OAuth immediately (production wiring)
    if (data?.redirectUrl) {
      window.location.href = data.redirectUrl
      return
    }

    // If backend isn’t wired yet, fail safely (no fake “connected” state)
    setIsConnecting(false)
    alert(
      "Connection endpoint is not available yet.\n\nWire /api/autopost/connect to return an OAuth URL, then this will go live."
    )
  }

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-pink-900/20" />
        <motion.div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(168, 85, 247, 0.15), transparent 40%)`,
          }}
        />
        <FloatingParticles />
      </div>

      {/* Header */}
      <header className="border-b border-gray-800/50 bg-black/50 backdrop-blur-xl sticky top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.h1
                className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                }}
                transition={{ duration: 5, repeat: Infinity }}
                style={{ backgroundSize: "200% 200%" }}
              >
                SirensForge
              </motion.h1>
              <ChevronRight className="w-4 h-4 text-gray-600" />
              <span className="text-gray-400">Autopost</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 text-xs text-gray-400 bg-gray-900/60 border border-gray-800 rounded-full px-3 py-2">
                <span className="text-gray-500">Connected:</span>
                <span className="text-white font-semibold">{connectedCount}</span>
                <span className="text-gray-600">•</span>
                <span className="text-gray-500">Selected:</span>
                <span className="text-white font-semibold">{selectedPlatforms.length}</span>
              </div>

              <motion.div animate={{ scale: previewStatus === "ready" ? [1, 1.05, 1] : 1 }} transition={{ duration: 2, repeat: Infinity }}>
                <div className={`px-4 py-2 rounded-full bg-gradient-to-r ${getStatusColor()} text-white text-sm font-semibold`}>
                  {getStatusText()}
                </div>
              </motion.div>

              <Button variant="ghost" onClick={() => (window.location.href = "/")} className="hover:bg-purple-500/10">
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-7xl mx-auto px-6 pt-12 pb-8 text-center relative z-10"
      >
        <motion.div
          animate={{
            rotate: [0, 5, -5, 0],
            scale: [1, 1.05, 1],
          }}
          transition={{ duration: 4, repeat: Infinity }}
          className="inline-block mb-4"
        >
          <Sparkles className="w-16 h-16 text-purple-400" />
        </motion.div>

        <h1 className="text-5xl md:text-6xl font-bold mb-4">
          <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">Automated Posting</span>
        </h1>

        <p className="text-xl text-gray-300 mb-4 max-w-2xl mx-auto">
          Publish approved content to your connected platforms with{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-semibold">full control</span>
          .
        </p>

        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-500/30 backdrop-blur-sm">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-300">No AI generation • No surprises • Full transparency</span>
        </div>

        {publicPlatformSelected && (
          <div className="mt-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
              <AlertCircle className="w-4 h-4" />
              Public platforms selected (X/Reddit): explicitness is capped for safety.
            </div>
          </div>
        )}
      </motion.div>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-6 pb-20 relative z-10">
        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left: Config */}
          <div className="lg:col-span-2 space-y-6">
            {/* Toggle */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-purple-500/10 relative overflow-hidden">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-pink-600/10 to-cyan-600/10"
                  animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                  transition={{ duration: 10, repeat: Infinity }}
                  style={{ backgroundSize: "200% 200%" }}
                />
                <CardContent className="p-6 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-white mb-1">Autopost Master Toggle</h3>
                      <p className="text-sm text-gray-400">Enable selection + posting (only for connected platforms)</p>
                    </div>
                    <button
                      onClick={() => setEnabled(!enabled)}
                      className={`relative w-16 h-8 rounded-full transition-all duration-300 ${
                        enabled ? "bg-gradient-to-r from-purple-600 to-pink-600" : "bg-gray-700"
                      }`}
                      style={{ boxShadow: enabled ? "0 0 20px rgba(168, 85, 247, 0.5)" : "none" }}
                    >
                      <motion.div
                        className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full"
                        animate={{ x: enabled ? 32 : 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Platforms */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-pink-500/10 relative overflow-hidden">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-pink-600/10 via-purple-600/10 to-cyan-600/10"
                  animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                  transition={{ duration: 10, repeat: Infinity }}
                  style={{ backgroundSize: "200% 200%" }}
                />
                <CardHeader className="relative z-10">
                  <CardTitle className="text-2xl bg-gradient-to-r from-pink-300 to-cyan-300 bg-clip-text text-transparent">
                    Posting Platforms
                  </CardTitle>
                  <CardDescription className="text-gray-400">Connected platforms can be selected for autopost</CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 relative z-10">
                  {platforms.map((platform, index) => {
                    const isSelected = selectedPlatforms.includes(platform.id)
                    const canInteract = enabled && platform.status !== "coming_soon"

                    return (
                      <motion.div
                        key={platform.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + index * 0.06 }}
                        whileHover={canInteract ? { scale: 1.02 } : undefined}
                        whileTap={canInteract ? { scale: 0.98 } : undefined}
                      >
                        <button
                          onClick={() => togglePlatform(platform.id)}
                          disabled={!canInteract}
                          className={`w-full p-4 rounded-xl border-2 transition-all ${
                            isSelected ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-600 bg-gray-800/50"
                          } ${!canInteract ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                  isSelected ? "border-purple-500 bg-purple-500" : "border-gray-600"
                                }`}
                              >
                                {isSelected && (
                                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                                    <Check className="w-3 h-3 text-white" />
                                  </motion.div>
                                )}
                              </div>

                              <div className="text-left">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-white">{platform.name}</span>
                                  {(platform.id === "x" || platform.id === "reddit") && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-200">
                                      PUBLIC
                                    </span>
                                  )}
                                </div>
                                {platform.notes && <div className="text-xs text-gray-500 mt-0.5">{platform.notes}</div>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {platform.connected ? (
                                <span className="px-3 py-1 rounded-full bg-emerald-500 text-white text-xs font-bold">CONNECTED</span>
                              ) : platform.status === "coming_soon" ? (
                                <span className="px-3 py-1 rounded-full bg-gray-700 text-gray-200 text-xs font-bold">COMING SOON</span>
                              ) : (
                                <span className="px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-bold">CONNECT</span>
                              )}
                            </div>
                          </div>
                        </button>
                      </motion.div>
                    )
                  })}
                </CardContent>
              </Card>
            </motion.div>

            {/* Frequency */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-cyan-500/10 relative overflow-hidden">
                <CardContent className="p-6">
                  <Label htmlFor="frequency" className="text-base text-gray-200 mb-3 block">
                    Posting Frequency
                  </Label>

                  <Select value={frequency} onValueChange={setFrequency} disabled={!enabled || !canScheduleNow}>
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (run each post)</SelectItem>
                      <SelectItem value="daily">Once per day</SelectItem>
                      <SelectItem value="48h">Every 48 hours</SelectItem>
                      <SelectItem value="72h">Every 72 hours</SelectItem>
                    </SelectContent>
                  </Select>

                  {!canScheduleNow ? (
                    <p className="text-xs text-amber-400 mt-2">⚡ Scheduling switches on after launch hardening (Phase 3)</p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-2">Scheduling enabled</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Content Filters */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-purple-500/10 relative overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-xl text-white">Content Filters</CardTitle>
                  <CardDescription className="text-gray-400">
                    These filters control what can be selected for a post (nothing is posted until you run it).
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Explicitness */}
                  <div>
                    <Label className="text-base text-gray-200 mb-3 block">
                      Max Explicitness:{" "}
                      <span className="text-purple-400 font-bold">
                        {explicitness}
                        <span className="text-gray-500 font-normal"> / {effectiveExplicitnessCap}</span>
                      </span>
                    </Label>

                    <input
                      type="range"
                      min="1"
                      max={effectiveExplicitnessCap}
                      value={explicitness}
                      onChange={e => setExplicitness(parseInt(e.target.value))}
                      disabled={!enabled}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />

                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                      <span>Soft</span>
                      <span>Moderate</span>
                      <span>Explicit</span>
                    </div>

                    {effectiveExplicitnessCap < 5 && (
                      <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5" />
                          <div>
                            <div className="font-semibold">Platform cap applied</div>
                            <div className="text-xs text-amber-200/80 mt-0.5">
                              One or more selected platforms enforces a lower explicitness ceiling for safety.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tones */}
                  <div>
                    <Label className="text-base text-gray-200 mb-3 block">
                      Tone Filters <span className="text-sm text-gray-500">({selectedTones.length} selected)</span>
                    </Label>

                    <div className="flex flex-wrap gap-2">
                      {toneOptions.map(tone => (
                        <motion.button
                          key={tone}
                          onClick={() => toggleTone(tone)}
                          disabled={!enabled}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                            selectedTones.includes(tone)
                              ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 border-2 border-purple-500 text-white"
                              : "bg-gray-800 border-2 border-gray-700 text-gray-400 hover:border-gray-600"
                          } ${!enabled ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {tone}
                        </motion.button>
                      ))}
                    </div>

                    {selectedTones.length > 0 && (
                      <button onClick={() => setSelectedTones([])} className="text-xs text-purple-400 hover:text-purple-300 mt-2">
                        Clear all
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Revenue Split */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-purple-900/30 via-pink-900/30 to-gray-900/90 backdrop-blur-xl relative overflow-hidden">
                <motion.div
                  className="absolute inset-0 border-2 border-transparent rounded-lg"
                  style={{
                    background: "linear-gradient(90deg, #a855f7, #ec4899, #06b6d4) border-box",
                    WebkitMask: "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                  }}
                  animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                  transition={{ duration: 5, repeat: Infinity }}
                />

                <CardContent className="p-6 relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <Crown className="w-6 h-6 text-yellow-400" />
                    <h3 className="text-lg font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                      Revenue Split
                    </h3>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-center">
                      <div className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
                        80%
                      </div>
                      <div className="text-sm text-gray-400 mt-1">Creator</div>
                    </div>
                    <div className="text-2xl text-gray-600">|</div>
                    <div className="text-center">
                      <div className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        20%
                      </div>
                      <div className="text-sm text-gray-400 mt-1">SirensForge</div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 mt-4 text-center">Used for internal reporting only (payments handled elsewhere).</p>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right: Status + Preview */}
          <div className="lg:col-span-3 space-y-6">
            {/* Status */}
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
              <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl relative overflow-hidden">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-pink-600/10 to-cyan-600/10"
                  animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                  transition={{ duration: 8, repeat: Infinity }}
                  style={{ backgroundSize: "200% 200%" }}
                />

                <CardContent className="p-8 relative z-10">
                  <div className="flex items-start gap-6">
                    <motion.div
                      animate={previewStatus === "ready" ? { scale: [1, 1.05, 1] } : {}}
                      transition={{ duration: 2, repeat: Infinity }}
                      className={`p-6 rounded-2xl bg-gradient-to-br ${getStatusColor()}/30 backdrop-blur-sm relative`}
                      style={{
                        boxShadow:
                          previewStatus === "ready"
                            ? "0 0 20px rgba(16, 185, 129, 0.3)"
                            : previewStatus === "partial"
                            ? "0 0 20px rgba(245, 158, 11, 0.3)"
                            : "0 0 20px rgba(239, 68, 68, 0.3)",
                      }}
                    >
                      {React.createElement(getStatusIcon(), { className: "w-12 h-12 text-white" })}
                    </motion.div>

                    <div className="flex-1">
                      <h3 className={`text-3xl font-bold bg-gradient-to-r ${getStatusColor()} bg-clip-text text-transparent mb-2`}>
                        {getStatusText()}
                      </h3>

                      {previewStatus === "blocked" && (
                        <p className="text-gray-300 mb-4">Autopost is disabled. Enable the toggle to begin configuration.</p>
                      )}

                      {previewStatus !== "blocked" && (
                        <p className="text-gray-300 mb-4">
                          Selected platforms: <span className="text-white font-semibold">{selectedPlatformNames || "None"}</span>
                        </p>
                      )}

                      {previewResult?.state === "BLOCKED" && previewResult.reason && (
                        <div className="mb-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <div>
                              <div className="font-semibold">Blocked</div>
                              <div className="text-xs text-rose-200/80 mt-0.5">{previewResult.reason}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {previewStatus === "blocked" && (
                        <Button
                          variant="outline"
                          onClick={() => setShowWhyBlockedModal(true)}
                          className="border-rose-500/50 text-rose-400 hover:bg-rose-500/10"
                        >
                          Why is Autopost blocked?
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Live Preview */}
            {(previewStatus === "ready" || previewStatus === "partial") && previewPayload && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl relative overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-2xl bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent">
                        Live Post Preview
                      </CardTitle>
                      <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full">Preview</span>
                    </div>
                    <CardDescription className="text-gray-400">
                      This shows what would be posted if you run it now (nothing is posted automatically at launch).
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-semibold text-white">{platformById.get(previewPayload.platform)?.name ?? previewPayload.platform}</span>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <Label className="text-sm text-gray-400 mb-2 block">Caption:</Label>
                          <p className="text-white whitespace-pre-wrap">{previewPayload.caption_text ?? "— none —"}</p>
                        </div>

                        <div className={previewPayload.cta_text ? "" : "opacity-50"}>
                          <Label className="text-sm text-gray-400 mb-2 block">CTA:</Label>
                          <p className={previewPayload.cta_text ? "text-white" : "text-gray-500 italic"}>
                            {previewPayload.cta_text ?? "— none —"}
                          </p>
                        </div>

                        <div className={previewPayload.hashtags?.length ? "" : "opacity-50"}>
                          <Label className="text-sm text-gray-400 mb-2 block">Hashtags:</Label>
                          <p className={previewPayload.hashtags?.length ? "text-white" : "text-gray-500 italic"}>
                            {previewPayload.hashtags?.length ? previewPayload.hashtags.join(" ") : "— none —"}
                          </p>
                        </div>

                        <div className="pt-4 border-t border-gray-700">
                          <Label className="text-sm text-gray-400 mb-2 block">Revenue:</Label>
                          <p className="text-sm">
                            <span className="text-emerald-400 font-semibold">Creator {previewPayload.revenue.creator_pct}%</span>
                            <span className="text-gray-500 mx-2">|</span>
                            <span className="text-purple-400 font-semibold">SirensForge {previewPayload.revenue.platform_pct}%</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Diagnostics */}
            {showDiagnostics && previewDiagnostics && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl">
                  <CardContent className="p-6">
                    <button onClick={() => setShowDiagnostics(!showDiagnostics)} className="flex items-center justify-between w-full mb-2">
                      <div className="text-left">
                        <span className="font-semibold text-cyan-400 flex items-center gap-2">
                          <Settings className="w-5 h-5" />
                          Selection Diagnostics
                        </span>
                        <p className="text-xs text-gray-500 mt-1">Why this content was selected (no data was modified)</p>
                      </div>
                      <motion.div animate={{ rotate: showDiagnostics ? 180 : 0 }}>
                        <ChevronRight className="w-5 h-5 text-cyan-400" />
                      </motion.div>
                    </button>

                    <div className="mt-4 space-y-3 font-mono text-sm">
                      <div className="flex justify-between text-gray-300">
                        <span>State:</span>
                        <span className="text-white font-bold">{previewResult?.state ?? "—"}</span>
                      </div>

                      <div className="flex justify-between text-gray-300">
                        <span>Platform:</span>
                        <span className="text-white font-bold">{platformById.get(previewDiagnostics.platform)?.name ?? previewDiagnostics.platform}</span>
                      </div>

                      <div className="flex justify-between text-gray-300">
                        <span>Timestamp:</span>
                        <span className="text-gray-400">{previewDiagnostics.timestamp}</span>
                      </div>

                      {previewResult?.reason && (
                        <div className="pt-3 border-t border-gray-700">
                          <div className="flex justify-between text-gray-300">
                            <span>Reason:</span>
                            <span className="text-gray-400">{previewResult.reason}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-12 sticky bottom-6 z-30"
        >
          <div className="bg-gray-900/95 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-white mb-1">Ready to preview?</h3>
                <p className="text-sm text-gray-400">Evaluate your selection criteria against the current approved pool</p>
              </div>

              <Button
                onClick={handlePreviewSelection}
                disabled={!enabled || selectedPlatforms.length === 0 || isEvaluating}
                className="px-8 py-6 text-lg font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl relative overflow-hidden"
              >
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
                {isEvaluating ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                      <Clock className="w-5 h-5 mr-2" />
                    </motion.div>
                    Evaluating…
                  </>
                ) : (
                  <>
                    <Settings className="w-5 h-5 mr-2" />
                    Preview Autopost Selection
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Why Blocked Modal */}
      <AnimatePresence>
        {showWhyBlockedModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-4"
            onClick={() => setShowWhyBlockedModal(false)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="max-w-lg w-full bg-gradient-to-br from-gray-900 to-black rounded-3xl border border-gray-800 shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="p-4 rounded-2xl bg-rose-500/20">
                    <AlertCircle className="w-8 h-8 text-rose-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Why is Autopost Blocked?</h3>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                    <div className="flex items-start gap-3">
                      <X className="w-5 h-5 text-rose-400 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-white mb-1">Autopost is disabled</h4>
                        <p className="text-sm text-gray-400">Enable the master toggle to activate selection + posting controls.</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                    <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-emerald-400 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-white mb-1">How to fix</h4>
                        <p className="text-sm text-gray-400">Toggle the master switch at the top of the configuration panel.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => setShowWhyBlockedModal(false)}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500"
                >
                  Got it
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Platform Connection Modal */}
      <AnimatePresence>
        {showConnectionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-4"
            onClick={() => {
              if (!isConnecting) setShowConnectionModal(false)
            }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="max-w-lg w-full bg-gradient-to-br from-gray-900 to-black rounded-3xl border border-gray-800 shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 space-y-6">
                <div className="text-center">
                  <div className="inline-flex p-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 mb-4">
                    <Shield className="w-12 h-12 text-purple-400" />
                  </div>

                  <h3 className="text-2xl font-bold text-white mb-2">
                    Connect {connectModalPlatform?.name ?? "Platform"}
                  </h3>

                  <p className="text-gray-400">
                    This will open a secure authorization flow. You can revoke access anytime.
                  </p>
                </div>

                {(connectModalPlatform?.id === "x" || connectModalPlatform?.id === "reddit") && (
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-amber-300" />
                      <div className="text-sm text-amber-200">
                        <div className="font-semibold">Public platform safety</div>
                        <div className="text-xs text-amber-200/80 mt-0.5">
                          We enforce a conservative explicitness cap for public platforms to reduce account risk.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm text-gray-300">Secure authentication</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm text-gray-300">Posting permissions only</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm text-gray-300">Revoke anytime</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowConnectionModal(false)}
                    className="flex-1 border-gray-700"
                    disabled={isConnecting}
                  >
                    Cancel
                  </Button>

                  <Button
                    onClick={handleConnect}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500"
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                          <Clock className="w-4 h-4 mr-2" />
                        </motion.div>
                        Opening…
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Connect
                      </>
                    )}
                  </Button>
                </div>

                <p className="text-xs text-gray-500 text-center">
                  Implementation note: wire <span className="text-gray-300">/api/autopost/connect</span> to return an OAuth URL.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// END OF FILE
