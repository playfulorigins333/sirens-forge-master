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
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Trash2,
  Save,
  List,
  Link2,
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
  | string

type Platform = {
  id: PlatformId
  name: string
  status?: "connected" | "not_connected" | "unknown"
  hint?: string
}

type PreviewStatus = "blocked" | "eligible" | "ineligible" | "error"

type AutopostPreviewResponse = {
  state?: "ELIGIBLE" | "INELIGIBLE" | "BLOCKED" | string
  reason?: string | null
  payload?: any
  diagnostics?: any
}

type AutopostRule = {
  id: string
  platform?: PlatformId | null
  selected_platforms?: PlatformId[] | null
  enabled: boolean
  approval_state: "DRAFT" | "APPROVED" | "PAUSED" | "REVOKED" | string
  explicitness?: number | null
  tones?: string[] | null
  frequency?: string | null
  created_at?: string | null
  updated_at?: string | null
  last_ran_at?: string | null
  next_run_at?: string | null
}

type RunResponse = {
  ran_at?: string
  processed?: number
  rules?: any[]
  error?: string
}

// -----------------------------
// Fallback platforms (if /api/autopost/platforms fails)
// -----------------------------
const FALLBACK_PLATFORMS: Platform[] = [
  { id: "fanvue", name: "Fanvue", status: "unknown" },
  { id: "onlyfans", name: "OnlyFans", status: "unknown" },
  { id: "fansly", name: "Fansly", status: "unknown" },
  { id: "loyalfans", name: "LoyalFans", status: "unknown" },
  { id: "justforfans", name: "JustForFans", status: "unknown" },
  { id: "x", name: "X (Twitter)", status: "unknown" },
  { id: "reddit", name: "Reddit", status: "unknown" },
]

// -----------------------------
// Helpers
// -----------------------------
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

function asRulesArray(maybe: any): AutopostRule[] {
  if (Array.isArray(maybe)) return maybe as AutopostRule[]
  if (maybe && Array.isArray(maybe.rules)) return maybe.rules as AutopostRule[]
  return []
}

function asPlatformsArray(maybe: any): Platform[] | null {
  if (!maybe) return null
  if (Array.isArray(maybe)) return maybe as Platform[]
  if (Array.isArray(maybe.platforms)) return maybe.platforms as Platform[]
  return null
}

function formatTs(ts?: string | null) {
  if (!ts) return "—"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString()
}

function prettyPlatform(p?: PlatformId | null) {
  if (!p) return "—"
  const map: Record<string, string> = {
    fanvue: "Fanvue",
    onlyfans: "OnlyFans",
    fansly: "Fansly",
    loyalfans: "LoyalFans",
    justforfans: "JustForFans",
    x: "X (Twitter)",
    reddit: "Reddit",
  }
  return map[p] ?? String(p)
}

function badgeForState(state: string) {
  const s = String(state || "").toUpperCase()
  if (s === "APPROVED") return { label: "APPROVED", icon: CheckCircle, cls: "bg-emerald-500/15 border-emerald-500/30 text-emerald-200" }
  if (s === "PAUSED") return { label: "PAUSED", icon: PauseCircle, cls: "bg-amber-500/15 border-amber-500/30 text-amber-200" }
  if (s === "REVOKED") return { label: "REVOKED", icon: X, cls: "bg-rose-500/15 border-rose-500/30 text-rose-200" }
  return { label: "DRAFT", icon: AlertCircle, cls: "bg-slate-500/15 border-slate-500/30 text-slate-200" }
}

function actionsFor(rule: AutopostRule) {
  const state = String(rule.approval_state).toUpperCase()
  return {
    canApprove: state === "DRAFT",
    canPause: state === "APPROVED",
    canResume: state === "PAUSED",
    canRevoke: state !== "REVOKED",
  }
}

// -----------------------------
// API calls
// -----------------------------
async function fetchPlatforms(): Promise<Platform[] | null> {
  try {
    const res = await fetch("/api/autopost/platforms", { method: "GET" })
    if (!res.ok) return null
    const data = await safeJson<any>(res)
    return asPlatformsArray(data)
  } catch {
    return null
  }
}

async function startConnectFlow(platform: PlatformId): Promise<{ redirectUrl?: string; url?: string } | null> {
  try {
    const res = await fetch(`/api/autopost/connect?platform=${encodeURIComponent(platform)}`, { method: "GET" })
    if (!res.ok) return null
    const data = await safeJson<{ redirectUrl?: string; url?: string }>(res)
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
  try {
    const res = await fetch("/api/autopost/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!res.ok) return await safeJson<any>(res)
    return await safeJson<AutopostPreviewResponse>(res)
  } catch {
    return null
  }
}

async function fetchRules(): Promise<any> {
  const res = await fetch("/api/autopost/rules", { method: "GET" })
  const j = await safeJson<any>(res)
  if (!res.ok) throw new Error(j?.error ? String(j.error) : `Failed to load rules (${res.status})`)
  return j
}

async function createRule(body: any): Promise<any> {
  const res = await fetch("/api/autopost/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const j = await safeJson<any>(res)
  if (!res.ok) throw new Error(j?.error ? String(j.error) : `Create rule failed (${res.status})`)
  return j
}

async function postRuleAction(ruleId: string, action: "approve" | "pause" | "resume" | "revoke", body?: any): Promise<any> {
  const res = await fetch(`/api/autopost/rules/${encodeURIComponent(ruleId)}/${action}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await safeJson<any>(res)
  if (!res.ok) throw new Error(j?.error ? String(j.error) : `${action} failed (${res.status})`)
  return j
}

async function runEligibleNow(): Promise<RunResponse> {
  const res = await fetch("/api/autopost/run", { method: "POST" })
  const j = await safeJson<RunResponse>(res)
  if (!res.ok) throw new Error(j?.error ? String(j.error) : `Run failed (${res.status})`)
  return j ?? {}
}

// -----------------------------
// Page
// -----------------------------
type Tab = "rules" | "builder" | "connect"

export default function AutopostPage() {
  const [mounted, setMounted] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  const [tab, setTab] = useState<Tab>("rules")

  // Server-backed state (with safe fallback)
  const [platforms, setPlatforms] = useState<Platform[]>(FALLBACK_PLATFORMS)

  // Builder config state (matches your /preview contract)
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
  const [builderError, setBuilderError] = useState<string | null>(null)
  const [builderSuccess, setBuilderSuccess] = useState<string | null>(null)

  // Rules state
  const [rules, setRules] = useState<AutopostRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)

  // Approve modal state
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [approveTarget, setApproveTarget] = useState<AutopostRule | null>(null)
  const [ackSplit, setAckSplit] = useState(false)
  const [ackAutomation, setAckAutomation] = useState(false)
  const [ackControl, setAckControl] = useState(false)

  // Run now state
  const [runningJob, setRunningJob] = useState(false)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const handleMouseMove = (e: MouseEvent) => setMousePosition({ x: e.clientX, y: e.clientY })
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [mounted])

  // Load platforms once
  useEffect(() => {
    if (!mounted) return
    ;(async () => {
      const p = await fetchPlatforms()
      if (p && p.length) setPlatforms(p)
    })()
  }, [mounted])

  const eligibleRulesCount = useMemo(() => {
    return rules.filter(r => String(r.approval_state).toUpperCase() === "APPROVED" && r.enabled === true).length
  }, [rules])

  const refreshRules = async () => {
    setRulesLoading(true)
    setRulesError(null)
    try {
      const data = await fetchRules()
      setRules(asRulesArray(data))
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Failed to load rules")
      setRules([])
    } finally {
      setRulesLoading(false)
    }
  }

  // Auto-load rules when tab opened
  useEffect(() => {
    if (!mounted) return
    if (tab !== "rules") return
    refreshRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mounted])

  // -----------------------------
  // Connect actions
  // -----------------------------
  const handleConnect = async (platform: PlatformId) => {
    setBuilderError(null)
    const result = await startConnectFlow(platform)
    const url = result?.redirectUrl || result?.url
    if (!url) {
      setBuilderError("Connect flow failed (no redirect URL returned).")
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  // -----------------------------
  // Preview + Save rule
  // -----------------------------
  const evaluatePreview = async () => {
    setIsEvaluating(true)
    setBuilderError(null)
    setBuilderSuccess(null)
    setPreviewResult(null)
    setRunResult(null)
    try {
      const res = await runPreviewSelection({
        enabled,
        selected_platforms: selectedPlatforms,
        explicitness,
        tones: selectedTones,
        frequency,
      })

      if (!res) {
        setPreviewStatus("error")
        setBuilderError("Preview failed (no response).")
        setIsEvaluating(false)
        return
      }

      setPreviewResult(res)

      const state = String(res.state || "").toUpperCase()
      if (state === "ELIGIBLE") setPreviewStatus("eligible")
      else if (state === "INELIGIBLE") setPreviewStatus("ineligible")
      else setPreviewStatus("blocked")
    } catch (e: any) {
      setPreviewStatus("error")
      setBuilderError(e?.message ? String(e.message) : "Preview failed")
    } finally {
      setIsEvaluating(false)
    }
  }

  const saveAsRule = async () => {
    setBuilderError(null)
    setBuilderSuccess(null)

    // We save the SAME config that preview uses.
    // Backend can store it as rule config + set approval_state=DRAFT by default.
    const body = {
      enabled,
      selected_platforms: selectedPlatforms,
      explicitness,
      tones: selectedTones,
      frequency,
      // optional: store latest preview output if your backend wants it
      preview_state: previewResult?.state ?? null,
      preview_reason: previewResult?.reason ?? null,
      preview_payload: previewResult?.payload ?? null,
    }

    try {
      await createRule(body)
      setBuilderSuccess("Rule saved as DRAFT. Approve it in My Rules when ready.")
      setTab("rules")
      await refreshRules()
    } catch (e: any) {
      setBuilderError(e?.message ? String(e.message) : "Save rule failed")
    }
  }

  // -----------------------------
  // Rule lifecycle actions
  // -----------------------------
  const openApprove = (rule: AutopostRule) => {
    setApproveTarget(rule)
    setAckSplit(false)
    setAckAutomation(false)
    setAckControl(false)
    setShowApproveModal(true)
  }

  const confirmApprove = async () => {
    if (!approveTarget) return
    setBusyRuleId(approveTarget.id)
    setRulesError(null)
    try {
      await postRuleAction(approveTarget.id, "approve", {
        accept_split: ackSplit,
        accept_automation: ackAutomation,
        accept_control: ackControl,
      })
      setShowApproveModal(false)
      setApproveTarget(null)
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Approve failed")
    } finally {
      setBusyRuleId(null)
      await refreshRules()
    }
  }

  const doPause = async (rule: AutopostRule) => {
    setBusyRuleId(rule.id)
    setRulesError(null)
    try {
      await postRuleAction(rule.id, "pause")
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Pause failed")
    } finally {
      setBusyRuleId(null)
      await refreshRules()
    }
  }

  const doResume = async (rule: AutopostRule) => {
    setBusyRuleId(rule.id)
    setRulesError(null)
    try {
      await postRuleAction(rule.id, "resume")
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Resume failed")
    } finally {
      setBusyRuleId(null)
      await refreshRules()
    }
  }

  const doRevoke = async (rule: AutopostRule) => {
    setBusyRuleId(rule.id)
    setRulesError(null)
    try {
      await postRuleAction(rule.id, "revoke")
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Revoke failed")
    } finally {
      setBusyRuleId(null)
      await refreshRules()
    }
  }

  // -----------------------------
  // Run eligible now
  // -----------------------------
  const handleRunNow = async () => {
    setRunningJob(true)
    setRunResult(null)
    setRulesError(null)
    try {
      const res = await runEligibleNow()
      setRunResult(res)
      await refreshRules()
    } catch (e: any) {
      setRulesError(e?.message ? String(e.message) : "Run failed")
    } finally {
      setRunningJob(false)
    }
  }

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-pink-900/20" />
        <motion.div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(168, 85, 247, 0.15), transparent 40%)`,
          }}
        />
      </div>

      {/* Header */}
      <header className="border-b border-gray-800/50 bg-black/50 backdrop-blur-xl sticky top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <motion.div animate={{ rotate: [0, 6, -6, 0], scale: [1, 1.05, 1] }} transition={{ duration: 5, repeat: Infinity }}>
                <Sparkles className="w-7 h-7 text-purple-400" />
              </motion.div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                  Autopost
                </h1>
                <p className="text-xs sm:text-sm text-gray-400">
                  Launch-ready: Connect → Build → Save → Approve/Pause/Resume/Revoke → Run
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-full bg-gray-900/60 border border-gray-800 text-xs text-gray-300">
                <Shield className="w-4 h-4 text-cyan-300" />
                Eligible rules: <span className="text-white font-semibold">{eligibleRulesCount}</span>
              </div>

              <Button
                onClick={handleRunNow}
                disabled={runningJob || eligibleRulesCount === 0}
                className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                title={eligibleRulesCount === 0 ? "No eligible rules: rule must be APPROVED and enabled" : undefined}
              >
                {runningJob ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    Run Eligible Rules Now
                  </>
                )}
              </Button>
              {eligibleRulesCount === 0 && (
                <div className="mt-1 text-xs text-amber-300">
                  No eligible rules. A rule must be <span className="font-semibold">APPROVED</span> and <span className="font-semibold">enabled</span> to run.
                </div>
              )}

              <Button
                variant="outline"
                className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                onClick={() => (tab === "rules" ? refreshRules() : setTab("rules"))}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${rulesLoading ? "animate-spin" : ""}`} />
                Refresh Rules
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant={tab === "rules" ? "default" : "outline"}
              onClick={() => setTab("rules")}
              className={tab === "rules" ? "bg-gray-900 border border-gray-700" : "border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"}
            >
              <List className="w-4 h-4 mr-2" />
              My Rules
            </Button>

            <Button
              variant={tab === "builder" ? "default" : "outline"}
              onClick={() => setTab("builder")}
              className={tab === "builder" ? "bg-gray-900 border border-gray-700" : "border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"}
            >
              <Settings className="w-4 h-4 mr-2" />
              Build Rule
            </Button>

            <Button
              variant={tab === "connect" ? "default" : "outline"}
              onClick={() => setTab("connect")}
              className={tab === "connect" ? "bg-gray-900 border border-gray-700" : "border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"}
            >
              <Link2 className="w-4 h-4 mr-2" />
              Connect
            </Button>
          </div>

          {runResult && (
            <div className="mt-3 text-xs text-gray-300 bg-gray-900/60 border border-gray-800 rounded-xl p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
                <span className="text-gray-400">ran_at:</span> <span className="text-white">{runResult.ran_at ?? "—"}</span>
                <span className="text-gray-400">processed:</span> <span className="text-white">{String(runResult.processed ?? 0)}</span>
              </div>
            </div>
          )}

          {rulesError && (
            <div className="mt-3 text-sm text-rose-200 bg-rose-950/40 border border-rose-900/40 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 mt-0.5" />
                <div>
                  <div className="font-semibold">Error</div>
                  <div className="text-rose-200/90">{rulesError}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {tab === "rules" && (
            <motion.div
              key="rules"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="bg-gray-900/40 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-300" />
                    My Rules
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Approve / Pause / Resume / Revoke are fully wired to your backend.
                    Only APPROVED + enabled rules run.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {rulesLoading ? (
                    <div className="text-gray-300 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  ) : rules.length === 0 ? (
                    <div className="text-gray-400">
                      No rules yet. Go to <span className="text-white font-semibold">Build Rule</span> to create one.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {rules.map(rule => {
                        const badge = badgeForState(rule.approval_state)
                        const BadgeIcon = badge.icon
                        const a = actionsFor(rule)
                        const busy = busyRuleId === rule.id

                        return (
                          <div key={rule.id} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm text-gray-400">Rule</div>
                                <div className="text-white font-semibold break-all">{rule.id}</div>
                                <div className="mt-2 text-sm text-gray-300">
                                  Platforms:{" "}
                                  <span className="text-white">
                                    {(rule.selected_platforms && rule.selected_platforms.length
                                      ? rule.selected_platforms
                                      : rule.platform
                                        ? [rule.platform]
                                        : []
                                    )
                                      .map(p => prettyPlatform(p))
                                      .join(", ") || "—"}
                                  </span>
                                </div>
                                <div className="mt-1 text-sm text-gray-300">
                                  Enabled: <span className="text-white font-semibold">{rule.enabled ? "true" : "false"}</span>
                                </div>
                              </div>

                              <div className={`shrink-0 px-3 py-2 rounded-xl border ${badge.cls}`}>
                                <div className="flex items-center gap-2 text-xs font-semibold">
                                  <BadgeIcon className="w-4 h-4" />
                                  {badge.label}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-400">
                              <div>
                                <div>Last ran</div>
                                <div className="text-gray-200">{formatTs(rule.last_ran_at)}</div>
                              </div>
                              <div>
                                <div>Next run</div>
                                <div className="text-gray-200">{formatTs(rule.next_run_at)}</div>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {a.canApprove && (
                                <Button
                                  onClick={() => openApprove(rule)}
                                  disabled={busy}
                                  className="bg-emerald-600 hover:bg-emerald-500"
                                >
                                  <CheckCircle className="w-4 h-4 mr-2" />
                                  Approve
                                </Button>
                              )}

                              {a.canPause && (
                                <Button
                                  variant="outline"
                                  onClick={() => doPause(rule)}
                                  disabled={busy}
                                  className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                                >
                                  <PauseCircle className="w-4 h-4 mr-2" />
                                  Pause
                                </Button>
                              )}

                              {a.canResume && (
                                <Button
                                  onClick={() => doResume(rule)}
                                  disabled={busy}
                                  className="bg-cyan-600 hover:bg-cyan-500"
                                >
                                  <PlayCircle className="w-4 h-4 mr-2" />
                                  Resume
                                </Button>
                              )}

                              {a.canRevoke && (
                                <Button
                                  variant="outline"
                                  onClick={() => doRevoke(rule)}
                                  disabled={busy}
                                  className="border-rose-900/60 bg-rose-950/20 text-rose-200 hover:bg-rose-950/40"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Revoke
                                </Button>
                              )}

                              {busy && (
                                <div className="flex items-center text-xs text-gray-400 ml-2">
                                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                  Working…
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {tab === "builder" && (
            <motion.div
              key="builder"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="bg-gray-900/40 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Settings className="w-5 h-5 text-purple-300" />
                    Build Rule
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    This uses your existing /api/autopost/preview contract, then saves the same config as a DRAFT rule.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                  {(builderError || builderSuccess) && (
                    <div
                      className={`text-sm rounded-xl p-3 border ${
                        builderError
                          ? "bg-rose-950/40 border-rose-900/40 text-rose-200"
                          : "bg-emerald-950/30 border-emerald-900/30 text-emerald-200"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {builderError ? <AlertCircle className="w-5 h-5 mt-0.5" /> : <CheckCircle className="w-5 h-5 mt-0.5" />}
                        <div>{builderError ?? builderSuccess}</div>
                      </div>
                    </div>
                  )}

                  {/* Enabled */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="text-gray-200">Enabled</Label>
                      <div className="text-xs text-gray-400">Rules won’t run unless enabled AND approved.</div>
                    </div>
                    <Button
                      variant="outline"
                      className={`border-gray-800 bg-transparent ${
                        enabled ? "text-emerald-200 hover:bg-emerald-950/30" : "text-gray-200 hover:bg-gray-900"
                      }`}
                      onClick={() => setEnabled(v => !v)}
                    >
                      {enabled ? (
                        <>
                          <Check className="w-4 h-4 mr-2" /> Enabled
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-2" /> Disabled
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Platforms */}
                  <div className="space-y-2">
                    <Label className="text-gray-200">Platforms</Label>
                    <div className="flex flex-wrap gap-2">
                      {platforms.map(p => {
                        const active = selectedPlatforms.includes(p.id)
                        return (
                          <Button
                            key={p.id}
                            variant="outline"
                            className={`border-gray-800 bg-transparent ${
                              active ? "text-white bg-gray-900" : "text-gray-200 hover:bg-gray-900"
                            }`}
                            onClick={() => {
                              setSelectedPlatforms(prev =>
                                prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]
                              )
                            }}
                          >
                            {active ? <Check className="w-4 h-4 mr-2" /> : <span className="w-4 h-4 mr-2" />}
                            {p.name}
                          </Button>
                        )
                      })}
                    </div>
                    <div className="text-xs text-gray-400">Select 1+ platforms for this rule.</div>
                  </div>

                  {/* Frequency */}
                  <div className="space-y-2">
                    <Label className="text-gray-200">Frequency</Label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="bg-black/30 border-gray-800 text-gray-200">
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-950 border-gray-800 text-gray-200">
                        <SelectItem value="manual">Manual (run via job)</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="twice_daily">Twice Daily</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Explicitness */}
                  <div className="space-y-2">
                    <Label className="text-gray-200">Explicitness</Label>
                    <Select value={String(explicitness)} onValueChange={v => setExplicitness(Number(v))}>
                      <SelectTrigger className="bg-black/30 border-gray-800 text-gray-200">
                        <SelectValue placeholder="Select explicitness" />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-950 border-gray-800 text-gray-200">
                        <SelectItem value="1">1 — Safe</SelectItem>
                        <SelectItem value="2">2 — Flirty</SelectItem>
                        <SelectItem value="3">3 — Teasing</SelectItem>
                        <SelectItem value="4">4 — Explicit</SelectItem>
                        <SelectItem value="5">5 — Hardcore</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tones */}
                  <div className="space-y-2">
                    <Label className="text-gray-200">Tones</Label>
                    <div className="flex flex-wrap gap-2">
                      {["Playful", "Teasing", "Luxury", "Dominant", "Sweet", "Dirty", "Confident", "Soft"].map(t => {
                        const active = selectedTones.includes(t)
                        return (
                          <Button
                            key={t}
                            variant="outline"
                            className={`border-gray-800 bg-transparent ${
                              active ? "text-white bg-gray-900" : "text-gray-200 hover:bg-gray-900"
                            }`}
                            onClick={() => {
                              setSelectedTones(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
                            }}
                          >
                            {active ? <Check className="w-4 h-4 mr-2" /> : <span className="w-4 h-4 mr-2" />}
                            {t}
                          </Button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={evaluatePreview}
                      disabled={isEvaluating || selectedPlatforms.length === 0}
                      className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                    >
                      {isEvaluating ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Evaluating…
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 mr-2" />
                          Preview Selection
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => setShowDiagnostics(v => !v)}
                      className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                      disabled={!previewResult}
                    >
                      <ChevronRight className={`w-4 h-4 mr-2 ${showDiagnostics ? "rotate-90" : ""}`} />
                      Diagnostics
                    </Button>

                    <Button
                      onClick={saveAsRule}
                      disabled={selectedPlatforms.length === 0}
                      className="bg-emerald-600 hover:bg-emerald-500"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save as Rule (DRAFT)
                    </Button>
                  </div>

                  {/* Preview output */}
                  <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-white font-semibold">Preview Result</div>
                      <div className="text-xs text-gray-400">
                        status:{" "}
                        <span className="text-gray-200 font-semibold">
                          {previewStatus.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-gray-300">
                      {previewResult?.reason ? (
                        <>
                          <span className="text-gray-400">reason:</span> <span className="text-gray-200">{String(previewResult.reason)}</span>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </div>

                    {previewResult?.payload && (
                      <pre className="mt-3 text-xs text-gray-200 bg-black/40 border border-gray-800 rounded-xl p-3 overflow-auto">
                        {JSON.stringify(previewResult.payload, null, 2)}
                      </pre>
                    )}

                    {showDiagnostics && previewResult?.diagnostics && (
                      <pre className="mt-3 text-xs text-gray-200 bg-black/40 border border-gray-800 rounded-xl p-3 overflow-auto">
                        {JSON.stringify(previewResult.diagnostics, null, 2)}
                      </pre>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {tab === "connect" && (
            <motion.div
              key="connect"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="bg-gray-900/40 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <ExternalLink className="w-5 h-5 text-cyan-300" />
                    Connect Platforms
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Uses /api/autopost/connect for each platform.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {platforms.map(p => (
                      <div key={p.id} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-white font-semibold">{p.name}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              status: <span className="text-gray-200">{p.status ?? "unknown"}</span>
                            </div>
                            {p.hint && <div className="text-xs text-gray-500 mt-1">{p.hint}</div>}
                          </div>
                          <Button
                            onClick={() => handleConnect(p.id)}
                            className="bg-cyan-600 hover:bg-cyan-500"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Connect
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Approve Modal */}
        <AnimatePresence>
          {showApproveModal && approveTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-xl rounded-2xl border border-gray-800 bg-gray-950 p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-white text-lg font-semibold">Approve Rule</div>
                    <div className="text-xs text-gray-400 mt-1 break-all">{approveTarget.id}</div>
                  </div>
                  <Button
                    variant="outline"
                    className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                    onClick={() => {
                      setShowApproveModal(false)
                      setApproveTarget(null)
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="text-sm text-gray-300">
                    You must acknowledge all three items to approve.
                  </div>

                  <label className="flex items-start gap-3 text-sm text-gray-200 cursor-pointer">
                    <input type="checkbox" checked={ackSplit} onChange={e => setAckSplit(e.target.checked)} className="mt-1" />
                    <span>I understand revenue splits / platform rules are my responsibility.</span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackAutomation}
                      onChange={e => setAckAutomation(e.target.checked)}
                      className="mt-1"
                    />
                    <span>I understand this rule may post automatically when scheduled.</span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackControl}
                      onChange={e => setAckControl(e.target.checked)}
                      className="mt-1"
                    />
                    <span>I understand I’m in control and can pause/revoke anytime.</span>
                  </label>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      onClick={confirmApprove}
                      disabled={!(ackSplit && ackAutomation && ackControl) || busyRuleId === approveTarget.id}
                      className="bg-emerald-600 hover:bg-emerald-500"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                      onClick={() => {
                        setShowApproveModal(false)
                        setApproveTarget(null)
                      }}
                    >
                      Cancel
                    </Button>
                    {busyRuleId === approveTarget.id && (
                      <div className="flex items-center text-xs text-gray-400 ml-2">
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Working…
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
