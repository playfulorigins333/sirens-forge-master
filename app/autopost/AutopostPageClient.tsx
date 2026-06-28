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

type PlatformLaunchStatus = "available" | "coming_soon" | "not_configured" | "unsupported"

type Platform = {
  id: PlatformId
  name: string
  label?: string
  external_url?: string
  launch_status?: PlatformLaunchStatus
  public_selectable?: boolean
  supports_real_posting?: boolean
  supports_assisted_workflow?: boolean
  reason?: string
  status_message?: string
  hint?: string
}

type UserPlatformStatus = Platform & {
  app_configured?: boolean
  oauth_configured?: boolean
  can_connect?: boolean
  user_connected?: boolean
  connection_status?: string | null
  provider_username?: string | null
  can_schedule?: boolean
  supports_text_posting?: boolean
  supports_media_posting?: boolean
  assisted_available?: boolean
  native_posting_available?: boolean
  native_posting_blocker?: string | null
  connection_blocker?: string | null
  disabled_reason?: string | null
  blockers?: string[]
  has_error?: boolean
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

// -----------------------------
// Fallback platforms
// -----------------------------
const FALLBACK_PLATFORM_STATUS = "Coming soon — not available for scheduled Autopost yet."

const FALLBACK_PLATFORMS: Platform[] = [
  { id: "fanvue", name: "Fanvue", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "onlyfans", name: "OnlyFans", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "fansly", name: "Fansly", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "loyalfans", name: "LoyalFans", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "justforfans", name: "JustForFans", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "x", name: "X (Twitter)", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
  { id: "reddit", name: "Reddit", launch_status: "coming_soon", public_selectable: false, status_message: FALLBACK_PLATFORM_STATUS },
]

const AUTOPOST_PACK_PREFILL_STORAGE_KEY = "sirensforge:autopost_pack_prefill"

const PLATFORM_URLS: Record<string, string> = {
  fanvue: "https://www.fanvue.com/",
  onlyfans: "https://onlyfans.com/",
  fansly: "https://fansly.com/",
  loyalfans: "https://www.loyalfans.com/",
  justforfans: "https://justfor.fans/",
  jff: "https://justfor.fans/",
  x: "https://x.com/",
  reddit: "https://www.reddit.com/",
}

function platformUrl(platform: PlatformId) {
  return PLATFORM_URLS[String(platform)] ?? null
}

function isPlatformSelectable(platform: Platform) {
  return platform.public_selectable === true && platform.supports_real_posting === true
}

function platformUnavailableMessage(platform: Platform) {
  if (platform.status_message) return platform.status_message
  if (platform.launch_status === "not_configured") return "Not configured — posting integration is not enabled."
  return "Coming soon — not available for scheduled Autopost yet."
}

type PackCaptionDraft = {
  id?: string
  title?: string
  caption?: string
  hashtags?: string
}

type AutopostPackPrefill = {
  source?: string
  action?: string
  platform?: PlatformId
  platforms?: PlatformId[]
  pack_name?: string
  collection_name?: string
  generation_ids?: string[]
  captions?: string[]
  hashtags?: string[]
  caption_drafts?: PackCaptionDraft[]
  assets?: any[]
  explicitness?: number
  tones?: string[]
  frequency?: string
  preview?: any
  created_at?: number
}

type SavedRuleSuccess = {
  ruleId: string | null
  platformLabels: string
  packName: string
  createdAt: string
  message?: string
}

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

function asUserPlatformStatusArray(maybe: any): UserPlatformStatus[] | null {
  if (!maybe) return null
  if (Array.isArray(maybe.platforms)) return maybe.platforms as UserPlatformStatus[]
  return null
}

function isValidHHmm(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
}

function getBestDraftTextFromPrefill(prefill: AutopostPackPrefill | null) {
  if (!prefill) return ""
  const firstDraftCaption = prefill.caption_drafts?.find((draft) => typeof draft.caption === "string" && draft.caption.trim())?.caption
  const firstCaption = prefill.captions?.find((caption) => typeof caption === "string" && caption.trim())
  return String(firstDraftCaption ?? firstCaption ?? "").replace(/\s+/g, " ").trim()
}

function normalizeHashtags(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  if (typeof value !== "string") return []
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
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
  return { label: "NEEDS APPROVAL", icon: AlertCircle, cls: "bg-slate-500/15 border-slate-500/30 text-slate-200" }
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

async function fetchUserPlatformStatuses(): Promise<UserPlatformStatus[] | null> {
  try {
    const res = await fetch("/api/autopost/platforms/me", { method: "GET" })
    if (res.status === 401) return null
    if (!res.ok) return null
    const data = await safeJson<any>(res)
    return asUserPlatformStatusArray(data)
  } catch {
    return null
  }
}

async function disconnectXAccount(): Promise<any> {
  const res = await fetch("/api/autopost/connect/x/disconnect", { method: "POST" })
  const j = await safeJson<any>(res)
  if (!res.ok) throw new Error(j?.error ? String(j.error) : `Disconnect X failed (${res.status})`)
  return j
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
  if (!res.ok) {
    const details = j?.details ? `: ${String(j.details)}` : ""
    const hint = j?.hint ? ` (${String(j.hint)})` : ""
    throw new Error(j?.error ? `${String(j.error)}${details}${hint}` : `Create rule failed (${res.status})`)
  }
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

// -----------------------------
// Page
// -----------------------------
type Tab = "rules" | "builder" | "platforms"

export default function AutopostPage() {
  const [mounted, setMounted] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  const [tab, setTab] = useState<Tab>("rules")

  // Server-backed state (with safe fallback)
  const [platforms, setPlatforms] = useState<Platform[]>(FALLBACK_PLATFORMS)
  const [userPlatformStatuses, setUserPlatformStatuses] = useState<UserPlatformStatus[]>([])
  const [xAccountBusy, setXAccountBusy] = useState(false)

  // Builder config state (matches your /preview contract)
  const [enabled, setEnabled] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>([])
  const [frequency, setFrequency] = useState("manual")
  const [explicitness, setExplicitness] = useState(3)
  const [selectedTones, setSelectedTones] = useState<string[]>(["Playful", "Teasing"])

  const [xDraftText, setXDraftText] = useState("")
  const [xDraftTimezone, setXDraftTimezone] = useState("America/New_York")
  const [xDraftStartDate, setXDraftStartDate] = useState("")
  const [xDraftEndDate, setXDraftEndDate] = useState("")
  const [xDraftTimeSlot, setXDraftTimeSlot] = useState("09:00")
  const [isSavingXDraft, setIsSavingXDraft] = useState(false)
  const [fanvueValidationDraftText, setFanvueValidationDraftText] = useState("")
  const [fanvueValidationAudience, setFanvueValidationAudience] = useState("internal_validation")
  const [isSavingFanvueValidationDraft, setIsSavingFanvueValidationDraft] = useState(false)

  const selectablePlatformIds = useMemo(() => {
    return new Set(platforms.filter(isPlatformSelectable).map((platform) => platform.id))
  }, [platforms])

  const hasSelectablePlatforms = selectablePlatformIds.size > 0

  const xStatus = useMemo(() => {
    return userPlatformStatuses.find((platform) => platform.id === "x") ?? null
  }, [userPlatformStatuses])

  const fanvueStatus = useMemo(() => {
    return userPlatformStatuses.find((platform) => platform.id === "fanvue") ?? null
  }, [userPlatformStatuses])

  const xUserConnected = xStatus?.user_connected === true && xStatus?.connection_status === "CONNECTED"
  const xCanConnect = xStatus?.can_connect === true
  const fanvueUserConnected = fanvueStatus?.user_connected === true && fanvueStatus?.connection_status === "CONNECTED"
  const xDraftCharacterCount = Array.from(xDraftText).length
  const xDraftTooLong = xDraftCharacterCount > 280
  const xDraftTimeSlotValid = isValidHHmm(xDraftTimeSlot)

  // Preview state
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("blocked")
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [previewResult, setPreviewResult] = useState<AutopostPreviewResponse | null>(null)
  const [builderError, setBuilderError] = useState<string | null>(null)
  const [builderSuccess, setBuilderSuccess] = useState<string | null>(null)
  const [savedRuleSuccess, setSavedRuleSuccess] = useState<SavedRuleSuccess | null>(null)
  const [packPrefill, setPackPrefill] = useState<AutopostPackPrefill | null>(null)

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

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const handleMouseMove = (e: MouseEvent) => setMousePosition({ x: e.clientX, y: e.clientY })
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [mounted])

  const refreshUserPlatformStatuses = async () => {
    const statuses = await fetchUserPlatformStatuses()
    setUserPlatformStatuses(statuses ?? [])
  }

  // Load platforms once
  useEffect(() => {
    if (!mounted) return
    ;(async () => {
      const [p, statuses] = await Promise.all([fetchPlatforms(), fetchUserPlatformStatuses()])
      if (p && p.length) setPlatforms(p)
      setUserPlatformStatuses(statuses ?? [])
    })()
  }, [mounted])

  useEffect(() => {
    setSelectedPlatforms(prev => prev.filter(platformId => selectablePlatformIds.has(platformId)))
  }, [selectablePlatformIds])

  // Load Generate → Autopost Builder handoff.
  useEffect(() => {
    if (!mounted) return
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const isGeneratePrefill =
      params.get("prefill") === "pack_builder" || params.get("from") === "generate"

    if (!isGeneratePrefill) return

    const raw = window.sessionStorage.getItem(AUTOPOST_PACK_PREFILL_STORAGE_KEY)

    if (!raw) {
      setTab("builder")
      setBuilderError("No Generate handoff was found in this browser session. Go back to /generate and send the pack again.")
      return
    }

    try {
      const parsed = JSON.parse(raw) as AutopostPackPrefill
      const incomingPlatforms = Array.isArray(parsed.platforms) && parsed.platforms.length > 0
        ? parsed.platforms.map((p) => String(p))
        : parsed.platform
          ? [String(parsed.platform)]
          : ["fanvue"]

      const incomingTones = Array.isArray(parsed.tones) && parsed.tones.length > 0
        ? parsed.tones.map((t) => String(t))
        : ["Playful", "Teasing"]

      const incomingExplicitness = Number(parsed.explicitness)

      setPackPrefill(parsed)
      const bestDraftText = getBestDraftTextFromPrefill(parsed)
      setXDraftText(bestDraftText)
      setFanvueValidationDraftText(bestDraftText)
      setTab("builder")
      setEnabled(false)
      setSelectedPlatforms(incomingPlatforms.filter((platform): platform is PlatformId => selectablePlatformIds.has(platform as PlatformId)))
      setFrequency(typeof parsed.frequency === "string" ? parsed.frequency : "manual")
      setExplicitness(Number.isFinite(incomingExplicitness) ? Math.max(1, Math.min(5, incomingExplicitness)) : 3)
      setSelectedTones(incomingTones)
      setPreviewStatus("blocked")
      setPreviewResult({
        state: "BLOCKED",
        reason: "Generate pack loaded. X draft preparation can use the first caption as text. Scheduled posting is not enabled yet.",
        payload: parsed,
        diagnostics: {
          source: parsed.source ?? "generate_pack_builder",
          generation_ids: parsed.generation_ids ?? [],
          caption_count: parsed.caption_drafts?.length ?? parsed.captions?.length ?? 0,
          asset_count: parsed.assets?.length ?? 0,
        },
      })
      setBuilderSuccess(
        incomingPlatforms.some((platform) => platform !== "x")
          ? "Pack loaded from Generate. Non-X platforms remain disabled; only X draft preparation is being built first. Scheduled posting is not enabled yet."
          : "Pack loaded from Generate. X draft preparation is available after connection; scheduled posting is not enabled yet."
      )
      setSavedRuleSuccess(null)
      setBuilderError(null)
      window.sessionStorage.removeItem(AUTOPOST_PACK_PREFILL_STORAGE_KEY)
    } catch (err) {
      console.error("Autopost prefill parse failed:", err)
      setTab("builder")
      setBuilderError("The Generate handoff could not be read. Go back to /generate and send the pack again.")
    }
  }, [mounted, selectablePlatformIds])

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
  // Preview + Save rule
  // -----------------------------
  const evaluatePreview = async () => {
    setIsEvaluating(true)
    setBuilderError(null)
    setBuilderSuccess(null)
    setSavedRuleSuccess(null)
    setPreviewResult(null)
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
    if (!hasSelectablePlatforms || selectedPlatforms.length === 0) {
      setBuilderError("Coming soon — not available for scheduled Autopost yet.")
      setBuilderSuccess(null)
      setSavedRuleSuccess(null)
      return
    }

    setBuilderError(null)
    setBuilderSuccess(null)
    setSavedRuleSuccess(null)

    // We save the SAME config that preview uses.
    // Backend can store it as rule config + set approval_state=DRAFT by default.
    const body = {
      enabled,
      selected_platforms: selectedPlatforms,
      explicitness,
      tones: selectedTones,
      frequency,
      preview_state: previewResult?.state ?? null,
      preview_reason: previewResult?.reason ?? null,
      preview_payload: previewResult?.payload ?? null,
      source: packPrefill ? "generate_pack_builder" : "autopost_builder",
      pack_name: packPrefill?.pack_name ?? packPrefill?.collection_name ?? null,
      generation_ids: packPrefill?.generation_ids ?? [],
      caption_drafts: packPrefill?.caption_drafts ?? [],
      captions: packPrefill?.captions ?? [],
      hashtags: packPrefill?.hashtags ?? [],
      assets: packPrefill?.assets ?? [],
    }

    try {
      const created = await createRule(body)
      const createdRuleId =
        created?.rule?.id ??
        created?.data?.id ??
        created?.id ??
        created?.rule_id ??
        null

      const platformLabels = selectedPlatforms.length > 0
        ? selectedPlatforms.map((p) => prettyPlatform(p)).join(", ")
        : "—"

      setSavedRuleSuccess({
        ruleId: createdRuleId ? String(createdRuleId) : null,
        platformLabels,
        packName: packPrefill?.pack_name || packPrefill?.collection_name || "Autopost Rule",
        createdAt: new Date().toISOString(),
      })
      setBuilderSuccess(null)
      await refreshRules()
    } catch (e: any) {
      setBuilderError(e?.message ? String(e.message) : "Save rule failed")
    }
  }

  const connectX = () => {
    if (typeof window === "undefined") return
    window.location.href = "/api/autopost/connect/x/start"
  }

  const disconnectX = async () => {
    setXAccountBusy(true)
    setBuilderError(null)
    setBuilderSuccess(null)
    try {
      await disconnectXAccount()
      await refreshUserPlatformStatuses()
      setBuilderSuccess("X disconnected. Scheduled posting is still disabled.")
    } catch (e: any) {
      setBuilderError(e?.message ? String(e.message) : "Disconnect X failed")
    } finally {
      setXAccountBusy(false)
    }
  }

  const saveXDraftRule = async () => {
    setBuilderError(null)
    setBuilderSuccess(null)
    setSavedRuleSuccess(null)

    const text = xDraftText.replace(/\s+/g, " ").trim()
    if (!xUserConnected) {
      setBuilderError("Connect X before saving an X draft rule.")
      return
    }
    if (!text) {
      setBuilderError("Add text content before saving an X draft.")
      return
    }
    if (Array.from(text).length > 280) {
      setBuilderError("X text must be 280 characters or fewer for this MVP draft.")
      return
    }
    if (!xDraftTimeSlotValid) {
      setBuilderError("Add one valid HH:mm time slot before saving an X draft.")
      return
    }

    const firstDraft = packPrefill?.caption_drafts?.[0]
    const body = {
      selected_platforms: ["x"],
      content_payload: {
        platform: "x",
        text,
        source: packPrefill ? "generate_pack_builder" : "autopost_ui",
        caption_draft_id: firstDraft?.id ?? null,
        hashtags: normalizeHashtags(firstDraft?.hashtags ?? packPrefill?.hashtags),
        media_posting_enabled: false,
      },
      text,
      source: packPrefill ? "generate_pack_builder" : "autopost_ui",
      generation_ids: packPrefill?.generation_ids ?? [],
      caption_drafts: packPrefill?.caption_drafts ?? [],
      captions: packPrefill?.captions ?? [],
      hashtags: packPrefill?.hashtags ?? [],
      assets: packPrefill?.assets ?? [],
      explicitness,
      tones: selectedTones,
      timezone: xDraftTimezone.trim() || "America/New_York",
      start_date: xDraftStartDate.trim() || null,
      end_date: xDraftEndDate.trim() || null,
      posts_per_day: 1,
      time_slots: [xDraftTimeSlot.trim()],
    }

    setIsSavingXDraft(true)
    try {
      const created = await createRule(body)
      const createdRuleId = created?.rule?.id ?? created?.data?.id ?? created?.id ?? created?.rule_id ?? null
      setSavedRuleSuccess({
        ruleId: createdRuleId ? String(createdRuleId) : null,
        platformLabels: "X (Twitter)",
        packName: packPrefill?.pack_name || packPrefill?.collection_name || "X Draft Rule",
        createdAt: new Date().toISOString(),
      })
      setBuilderSuccess("X draft saved. Scheduled posting is still disabled until final posting checks are complete.")
      await refreshRules()
    } catch (e: any) {
      setBuilderError(e?.message ? String(e.message) : "Save X draft failed")
    } finally {
      setIsSavingXDraft(false)
    }
  }

  const saveFanvueInternalValidationDraftRule = async () => {
    setBuilderError(null)
    setBuilderSuccess(null)
    setSavedRuleSuccess(null)

    const text = fanvueValidationDraftText.replace(/\s+/g, " ").trim()
    const audience = fanvueValidationAudience.replace(/\s+/g, "_").trim() || "internal_validation"

    if (!fanvueUserConnected) {
      setBuilderError("Fanvue OAuth validation connection is required before saving a Fanvue validation draft.")
      return
    }

    if (!text) {
      setBuilderError("Add Fanvue validation draft text before saving.")
      return
    }

    if (Array.from(text).length > 5000) {
      setBuilderError("Fanvue validation draft text must be 5000 characters or fewer.")
      return
    }

    const firstDraft = packPrefill?.caption_drafts?.[0]
    const body = {
      selected_platforms: ["fanvue"],
      content_payload: {
        platform: "fanvue",
        content_type: "text",
        text,
        audience,
        source: packPrefill ? "generate_pack_builder" : "autopost_ui_internal_validation",
        caption_draft_id: firstDraft?.id ?? null,
        media_upload_enabled: false,
        native_posting_enabled: false,
        dispatch_enabled: false,
      },
      text,
      audience,
      content_type: "text",
      source: packPrefill ? "generate_pack_builder" : "autopost_ui_internal_validation",
      generation_ids: packPrefill?.generation_ids ?? [],
      caption_drafts: packPrefill?.caption_drafts ?? [],
      captions: [],
      hashtags: [],
      assets: [],
      timezone: "UTC",
      start_date: null,
      end_date: null,
      posts_per_day: 1,
      time_slots: ["00:00"],
      explicitness,
      tones: selectedTones,
    }

    setIsSavingFanvueValidationDraft(true)
    try {
      const created = await createRule(body)
      const createdRuleId = created?.rule?.id ?? created?.data?.id ?? created?.id ?? created?.rule_id ?? null
      setSavedRuleSuccess({
        ruleId: createdRuleId ? String(createdRuleId) : null,
        platformLabels: "Fanvue",
        packName: packPrefill?.pack_name || packPrefill?.collection_name || "Fanvue Validation Draft",
        createdAt: new Date().toISOString(),
        message: "Fanvue validation draft saved. Native posting, scheduling, dispatch, and media upload remain disabled.",
      })
      setBuilderSuccess("Fanvue validation draft saved. Native posting, scheduling, dispatch, and media upload remain disabled.")
      await refreshRules()
    } catch (e: any) {
      setBuilderError(e?.message ? String(e.message) : "Save Fanvue validation draft failed")
    } finally {
      setIsSavingFanvueValidationDraft(false)
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

  const startNextPack = (variant: "similar" | "different_style") => {
    if (typeof window === "undefined") return

    const nextPackSeed = {
      source: "autopost_success",
      action: variant,
      pack_name: savedRuleSuccess?.packName ?? packPrefill?.pack_name ?? packPrefill?.collection_name ?? "Content Pack",
      platforms: selectedPlatforms,
      tones: selectedTones,
      explicitness,
      style_hint: variant === "similar" ? "same tone and content direction" : "fresh style direction with the same creator intent",
      created_at: Date.now(),
    }

    window.sessionStorage.setItem("sirensforge:next_pack_seed", JSON.stringify(nextPackSeed))
    const mode = variant === "similar" ? "similar_pack" : "different_style"
    window.location.href = `/generate?from=autopost&next_pack=${mode}`
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
                  Create and manage posting rules for your content workflow.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-full bg-gray-900/60 border border-gray-800 text-xs text-gray-300">
                <Shield className="w-4 h-4 text-cyan-300" />
                Active rules: <span className="text-white font-semibold">{eligibleRulesCount}</span>
              </div>

              <Button
                disabled
                className="bg-gray-800 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                title="Assisted posting helps organize approved distribution workflows."
              >
                <Clock className="w-4 h-4 mr-2" />
                Distribution Workflow
              </Button>
              <div className="mt-1 text-xs text-gray-400">
                Posting rules help organize approved content for distribution.
              </div>

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
              variant={tab === "platforms" ? "default" : "outline"}
              onClick={() => setTab("platforms")}
              className={tab === "platforms" ? "bg-gray-900 border border-gray-700" : "border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Platforms
            </Button>
          </div>

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
              <Card className="overflow-hidden border-gray-800 bg-gray-950/70 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-3 border-b border-gray-800/80 bg-gradient-to-r from-gray-950 via-gray-950 to-purple-950/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-500/10 text-amber-200">
                        <Crown className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-white">My Rules</h2>
                          <span className="rounded-full border border-gray-700 bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-300">
                            {rules.length} total
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          Review, approve, pause, or revoke your saved posting workflow rules.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200">
                        {eligibleRulesCount} active
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshRules}
                        className="h-9 border-gray-800 bg-black/30 text-xs text-gray-200 hover:bg-gray-900"
                      >
                        <RefreshCw className={`mr-2 h-4 w-4 ${rulesLoading ? "animate-spin" : ""}`} />
                        Refresh
                      </Button>
                    </div>
                  </div>

                  <div className="p-4">
                    {rulesLoading ? (
                      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-gray-800 bg-black/30 text-sm text-gray-300">
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Loading rules…
                      </div>
                    ) : rules.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-gray-800 bg-black/30 px-5 py-10 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-500/25 bg-purple-500/10 text-purple-200">
                          <Settings className="h-5 w-5" />
                        </div>
                        <div className="mt-4 text-base font-semibold text-white">No autopost rules yet</div>
                        <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-400">
                          Build your first rule from a content pack, review the settings, then approve it when you are ready.
                        </div>
                        <Button
                          type="button"
                          onClick={() => setTab("builder")}
                          className="mt-5 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Build Rule
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {rules.map(rule => {
                          const badge = badgeForState(rule.approval_state)
                          const BadgeIcon = badge.icon
                          const a = actionsFor(rule)
                          const busy = busyRuleId === rule.id
                          const rulePlatforms = (rule.selected_platforms && rule.selected_platforms.length
                            ? rule.selected_platforms
                            : rule.platform
                              ? [rule.platform]
                              : []
                          )

                          return (
                            <div key={rule.id} className="overflow-hidden rounded-3xl border border-gray-800 bg-black/30 transition hover:border-gray-700 hover:bg-black/40">
                              <div className="flex flex-col gap-3 border-b border-gray-800/80 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Rule</div>
                                    <div className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${badge.cls}`}>
                                      <div className="flex items-center gap-1.5">
                                        <BadgeIcon className="h-3.5 w-3.5" />
                                        {badge.label}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-2 break-all font-mono text-xs text-gray-200">{rule.id}</div>
                                </div>

                                <div className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${rule.enabled ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-900/60 text-gray-300"}`}>
                                  {rule.enabled ? "Enabled" : "Disabled"}
                                </div>
                              </div>

                              <div className="space-y-4 px-4 py-4">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Platforms</div>
                                    <div className="mt-1 truncate text-sm font-semibold text-white">
                                      {rulePlatforms.map(p => prettyPlatform(p)).join(", ") || "—"}
                                    </div>
                                  </div>
                                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Last Run</div>
                                    <div className="mt-1 truncate text-sm font-semibold text-gray-200">{formatTs(rule.last_ran_at)}</div>
                                  </div>
                                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Next Run</div>
                                    <div className="mt-1 truncate text-sm font-semibold text-gray-200">{formatTs(rule.next_run_at)}</div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  {a.canApprove && (
                                    <Button
                                      onClick={() => openApprove(rule)}
                                      disabled={busy}
                                      className="bg-emerald-600 hover:bg-emerald-500"
                                    >
                                      <CheckCircle className="mr-2 h-4 w-4" />
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
                                      <PauseCircle className="mr-2 h-4 w-4" />
                                      Pause
                                    </Button>
                                  )}

                                  {a.canResume && (
                                    <Button
                                      onClick={() => doResume(rule)}
                                      disabled={busy}
                                      className="bg-cyan-600 hover:bg-cyan-500"
                                    >
                                      <PlayCircle className="mr-2 h-4 w-4" />
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
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Revoke
                                    </Button>
                                  )}

                                  {busy && (
                                    <div className="flex items-center text-xs text-gray-400">
                                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                      Updating…
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
                    Prepare draft content safely. Scheduled posting remains disabled until final posting checks are complete.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                  {builderError && (
                    <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-sm text-rose-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-5 w-5" />
                        <div>{builderError}</div>
                      </div>
                    </div>
                  )}

                  {builderSuccess && !savedRuleSuccess && (
                    <div className="rounded-xl border border-emerald-900/30 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                      <div className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-5 w-5" />
                        <div>{builderSuccess}</div>
                      </div>
                    </div>
                  )}

                  {savedRuleSuccess && (
                    <div className="overflow-hidden rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/45 via-black/45 to-cyan-950/30 shadow-[0_0_44px_rgba(16,185,129,0.14)]">
                      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                              <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                              Draft Saved Successfully
                            </div>
                            <div className="mt-3 text-lg font-bold text-white">
                              Draft rule saved
                            </div>
                            <div className="mt-1 max-w-3xl text-xs leading-5 text-gray-300">
                              {savedRuleSuccess.message ?? "Your draft has been saved safely. Nothing has been sent to X or scheduled. Scheduled posting is still disabled until final posting checks are complete."}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-emerald-500/20 bg-black/30 px-3 py-2 text-xs text-emerald-100">
                            Non-runnable draft
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Rule</div>
                          <div className="mt-1 truncate text-sm font-semibold text-white">
                            {savedRuleSuccess.ruleId ?? "Created"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Pack</div>
                          <div className="mt-1 truncate text-sm font-semibold text-white">
                            {savedRuleSuccess.packName}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Platforms</div>
                          <div className="mt-1 truncate text-sm font-semibold text-white">
                            {savedRuleSuccess.platformLabels}
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-white/10 bg-black/20 px-4 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="text-xs leading-5 text-gray-400">
                            Next step: keep this as a draft while X posting checks and run/result persistence are completed.
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => {
                                setTab("rules")
                                refreshRules()
                              }}
                              className="bg-emerald-600 hover:bg-emerald-500"
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              View My Rules
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setSavedRuleSuccess(null)
                                setBuilderSuccess(null)
                                setPreviewResult(null)
                                setPreviewStatus("blocked")
                                setPackPrefill(null)
                              }}
                              className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                            >
                              Build Another Rule
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-2xl border border-purple-500/25 bg-gradient-to-r from-purple-950/35 via-black/35 to-cyan-950/25">
                          <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                            <div className="min-w-0">
                              <div className="inline-flex items-center rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-purple-100">
                                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                                Keep Creating
                              </div>
                              <div className="mt-2 text-sm font-bold text-white">Create another pack from this direction</div>
                              <div className="mt-1 max-w-2xl text-xs leading-5 text-gray-400">
                                Continue the session while the idea is fresh. Send a safe handoff back to Generate with the same tone, platform, and pack context.
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => startNextPack("similar")}
                                className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                              >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Generate Similar Pack
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => startNextPack("different_style")}
                                className="border-gray-800 bg-black/30 text-gray-200 hover:bg-gray-900"
                              >
                                Try Different Style
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {fanvueUserConnected && (
                    <div className="rounded-3xl border border-purple-500/25 bg-purple-950/10 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="inline-flex items-center rounded-full border border-purple-400/35 bg-purple-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-purple-100">
                            Fanvue internal validation only
                          </div>
                          <div className="mt-3 text-lg font-bold text-white">
                            Prepare a non-runnable Fanvue draft
                          </div>
                          <div className="mt-1 max-w-3xl text-xs leading-5 text-gray-300">
                            Connected as @{fanvueStatus?.provider_username ?? "Fanvue account"} for OAuth validation only
                          </div>
                          <div className="mt-2 max-w-3xl text-xs leading-5 text-gray-300">
                            This saves Fanvue draft metadata for internal validation. It does not post to Fanvue, schedule Fanvue posts, upload media, or enable native posting.
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {["Internal validation only", "Non-runnable draft", "Native posting disabled", "Scheduling disabled", "Media upload disabled"].map((badge) => (
                              <span key={badge} className="rounded-full border border-purple-400/25 bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-purple-100">
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
                          Connected OAuth
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
                        <div className="space-y-2">
                          <Label className="text-gray-200">Fanvue validation draft text</Label>
                          <textarea
                            value={fanvueValidationDraftText}
                            onChange={(event) => setFanvueValidationDraftText(event.target.value)}
                            rows={6}
                            className="w-full rounded-2xl border border-gray-800 bg-black/30 px-3 py-3 text-sm leading-6 text-gray-100 outline-none placeholder:text-gray-600 focus:border-purple-500/60"
                            placeholder="Write text-only Fanvue validation metadata. No media is uploaded."
                          />
                          <div className={`text-xs ${Array.from(fanvueValidationDraftText).length > 5000 ? "text-rose-200" : "text-gray-400"}`}>
                            {Array.from(fanvueValidationDraftText).length}/5000 characters. Text-only metadata is stored for validation.
                          </div>
                        </div>

                        <div className="space-y-3 rounded-2xl border border-gray-800 bg-black/30 p-3">
                          <div>
                            <Label className="text-gray-200">Internal validation audience key</Label>
                            <input
                              value={fanvueValidationAudience}
                              onChange={(event) => setFanvueValidationAudience(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none focus:border-purple-500/60"
                              placeholder="internal_validation"
                            />
                            <div className="mt-1 text-xs text-gray-400">Explicit internal metadata only; this is not a public placement.</div>
                          </div>
                          <Button
                            type="button"
                            onClick={saveFanvueInternalValidationDraftRule}
                            disabled={isSavingFanvueValidationDraft || !fanvueValidationDraftText.trim() || Array.from(fanvueValidationDraftText).length > 5000 || !!savedRuleSuccess}
                            className="w-full bg-purple-600 hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingFanvueValidationDraft ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Fanvue Validation Draft
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-3xl border border-cyan-500/25 bg-cyan-950/10 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">
                          X draft preparation
                        </div>
                        <div className="mt-3 text-lg font-bold text-white">Connect X to prepare a text-only draft</div>
                        <div className="mt-1 max-w-3xl text-xs leading-5 text-gray-300">
                          X draft preparation is available after connection. Scheduled posting is not enabled yet. This saves a non-runnable draft rule only.
                        </div>
                        {xStatus?.blockers && xStatus.blockers.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {xStatus.blockers.map((blocker) => (
                              <span key={blocker} className="rounded-full border border-gray-700 bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-300">
                                {blocker.replaceAll("_", " ")}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 rounded-2xl border border-gray-800 bg-black/30 p-3 text-sm text-gray-200 lg:min-w-72">
                        {xUserConnected ? (
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">X connection</div>
                              <div className="mt-1 font-semibold text-emerald-200">
                                Connected{xStatus?.provider_username ? ` as @${xStatus.provider_username}` : ""}
                              </div>
                              <div className="mt-1 text-xs text-gray-400">Scheduled posting is not enabled yet.</div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={xAccountBusy}
                              onClick={disconnectX}
                              className="w-full border-rose-900/60 bg-rose-950/20 text-rose-200 hover:bg-rose-950/40"
                            >
                              {xAccountBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                              Disconnect X
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">X connection</div>
                              <div className="mt-1 font-semibold text-gray-200">
                                {xCanConnect ? "Not connected" : "OAuth not configured"}
                              </div>
                              <div className="mt-1 text-xs text-gray-400">Connect X to prepare a draft. This does not enable scheduled posting.</div>
                            </div>
                            <Button
                              type="button"
                              disabled={!xCanConnect}
                              onClick={connectX}
                              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Connect X
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
                      <div className="space-y-2">
                        <Label className="text-gray-200">X text content</Label>
                        <textarea
                          value={xDraftText}
                          onChange={(event) => setXDraftText(event.target.value)}
                          rows={6}
                          className="w-full rounded-2xl border border-gray-800 bg-black/30 px-3 py-3 text-sm leading-6 text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-500/60"
                          placeholder="Write the text-only X draft. Media is metadata only for now."
                        />
                        <div className={`text-xs ${xDraftTooLong ? "text-rose-200" : "text-gray-400"}`}>
                          {xDraftCharacterCount}/280 characters. Exact X weighted counting will be handled before posting expands beyond draft preparation.
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-gray-800 bg-black/30 p-3">
                        <div>
                          <Label className="text-gray-200">Timezone</Label>
                          <input
                            value={xDraftTimezone}
                            onChange={(event) => setXDraftTimezone(event.target.value)}
                            className="mt-1 w-full rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500/60"
                            placeholder="America/New_York"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-gray-200">Start date</Label>
                            <input
                              type="date"
                              value={xDraftStartDate}
                              onChange={(event) => setXDraftStartDate(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500/60"
                            />
                          </div>
                          <div>
                            <Label className="text-gray-200">End date</Label>
                            <input
                              type="date"
                              value={xDraftEndDate}
                              onChange={(event) => setXDraftEndDate(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500/60"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-gray-200">Time slot</Label>
                          <input
                            type="time"
                            value={xDraftTimeSlot}
                            onChange={(event) => setXDraftTimeSlot(event.target.value)}
                            className="mt-1 w-full rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500/60"
                          />
                          {!xDraftTimeSlotValid && <div className="mt-1 text-xs text-rose-200">Use one valid HH:mm time slot.</div>}
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-300">
                          1 post/day MVP. Scheduled posting is not enabled yet.
                        </div>
                        <Button
                          type="button"
                          onClick={saveXDraftRule}
                          disabled={isSavingXDraft || !xUserConnected || !xDraftText.trim() || xDraftTooLong || !xDraftTimeSlotValid || !!savedRuleSuccess}
                          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingXDraft ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                          {savedRuleSuccess ? "X Draft Saved" : "Save X Draft"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {packPrefill && (
                    <div className="overflow-hidden rounded-3xl border border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-950/35 via-black/40 to-cyan-950/25 shadow-[0_0_40px_rgba(217,70,239,0.12)]">
                      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fuchsia-100">
                                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                                Loaded from Generate
                              </span>
                              <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                                Pack handoff
                              </span>
                            </div>

                            <div className="mt-3 text-lg font-bold text-white">
                              {packPrefill.pack_name || packPrefill.collection_name || "Creator Content Pack"}
                            </div>
                            <div className="mt-1 max-w-3xl text-xs leading-5 text-gray-300">
                              This pack came from the Generate Pack Builder. X text can be prefilled from the first caption. Scheduled posting is not enabled yet.
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            className="shrink-0 border-gray-800 bg-black/30 text-gray-200 hover:bg-gray-900"
                            onClick={() => {
                              setPackPrefill(null)
                              setPreviewResult(null)
                              setPreviewStatus("blocked")
                              setBuilderSuccess(null)
                              setSavedRuleSuccess(null)
                            }}
                          >
                            <X className="w-4 h-4 mr-2" />
                            Clear Handoff
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-2">
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Assets</div>
                              <div className="mt-1 text-xl font-bold text-white">{packPrefill.assets?.length ?? packPrefill.generation_ids?.length ?? 0}</div>
                            </div>
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Captions</div>
                              <div className="mt-1 text-xl font-bold text-white">{packPrefill.caption_drafts?.length ?? packPrefill.captions?.length ?? 0}</div>
                            </div>
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Platform</div>
                              <div className="mt-1 truncate text-sm font-bold text-white">
                                {(packPrefill.platforms && packPrefill.platforms.length > 0
                                  ? packPrefill.platforms.map((p) => prettyPlatform(p)).join(", ")
                                  : prettyPlatform(packPrefill.platform)) || "Fanvue"}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Mode</div>
                              <div className="mt-1 text-sm font-bold text-white">Draft only</div>
                            </div>
                          </div>

                          {packPrefill.assets && packPrefill.assets.length > 0 && (
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-gray-200">Pack Assets</div>
                                <div className="text-[10px] text-gray-500">Preview only</div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-3">
                                {packPrefill.assets.slice(0, 6).map((asset: any, index: number) => (
                                  <div key={`${asset?.generation_id ?? asset?.url ?? index}`} className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
                                    {asset?.url ? (
                                      asset?.kind === "video" ? (
                                        <video src={asset.url} className="aspect-square w-full object-cover" muted playsInline />
                                      ) : (
                                        <img src={asset.url} alt={`Pack asset ${index + 1}`} className="aspect-square w-full object-cover" />
                                      )
                                    ) : (
                                      <div className="flex aspect-square w-full items-center justify-center bg-gray-900 text-[10px] text-gray-500">
                                        Asset {index + 1}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {packPrefill.assets.length > 6 && (
                                <div className="mt-2 text-[11px] text-gray-500">
                                  + {packPrefill.assets.length - 6} more assets in this pack
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold text-gray-200">Next Step</div>
                                <div className="mt-1 text-[11px] leading-5 text-gray-400">
                                  Save an X draft when connected. This does not approve, schedule, or post anything.
                                </div>
                              </div>
                              <div className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200 sm:block">
                                Safe handoff
                              </div>
                            </div>
                          </div>

                          {packPrefill.caption_drafts && packPrefill.caption_drafts.length > 0 ? (
                            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-gray-200">Caption Drafts</div>
                                <div className="text-[10px] text-gray-500">First {Math.min(packPrefill.caption_drafts.length, 4)} shown</div>
                              </div>
                              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                                {packPrefill.caption_drafts.slice(0, 4).map((draft, index) => (
                                  <div key={`${draft.id ?? index}`} className="rounded-xl border border-gray-800 bg-gray-950/80 p-3">
                                    <div className="text-xs font-semibold text-white">
                                      {draft.title || `Caption ${index + 1}`}
                                    </div>
                                    {draft.caption && (
                                      <div className="mt-1 text-xs leading-5 text-gray-300">
                                        {draft.caption}
                                      </div>
                                    )}
                                    {draft.hashtags && (
                                      <div className="mt-2 text-[11px] leading-5 text-cyan-200">
                                        {draft.hashtags}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
                              No caption drafts were included with this pack. Add X text before saving a draft rule.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Enabled */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="text-gray-200">Enabled</Label>
                      <div className="text-xs text-gray-400">Turn this on when you want the approved rule included in your distribution workflow.</div>
                    </div>
                    <Button
                      variant="outline"
                      className={`border-gray-800 bg-transparent ${
                        enabled ? "text-emerald-200 hover:bg-emerald-950/30" : "text-gray-200 hover:bg-gray-900"
                      }`}
                      onClick={() => {
                        if (!hasSelectablePlatforms) return
                        setEnabled(v => !v)
                      }}
                      disabled={!hasSelectablePlatforms}
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
                        const selectable = isPlatformSelectable(p)
                        return (
                          <Button
                            key={p.id}
                            variant="outline"
                            disabled={!selectable}
                            title={selectable ? undefined : platformUnavailableMessage(p)}
                            className={`border-gray-800 bg-transparent disabled:cursor-not-allowed disabled:opacity-50 ${
                              active ? "text-white bg-gray-900" : "text-gray-200 hover:bg-gray-900"
                            }`}
                            onClick={() => {
                              if (!selectable) return
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
                    <div className="text-xs text-gray-400">
                      {hasSelectablePlatforms
                        ? "Select 1+ available platforms for this scheduled Autopost rule."
                        : "Scheduled Autopost selection is disabled. Use Save X Draft for non-runnable X draft preparation."}
                    </div>
                  </div>

                  {/* Frequency */}
                  <div className="space-y-2">
                    <Label className="text-gray-200">Frequency</Label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="bg-black/30 border-gray-800 text-gray-200">
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-950 border-gray-800 text-gray-200">
                        <SelectItem value="manual">Manual review</SelectItem>
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
                      disabled={isEvaluating || !hasSelectablePlatforms || selectedPlatforms.length === 0}
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
                          Preview Rule
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => setShowDetails(v => !v)}
                      className="border-gray-800 bg-transparent text-gray-200 hover:bg-gray-900"
                      disabled={!previewResult}
                    >
                      <ChevronRight className={`w-4 h-4 mr-2 ${showDetails ? "rotate-90" : ""}`} />
                      Details
                    </Button>

                    <Button
                      onClick={saveAsRule}
                      disabled={!hasSelectablePlatforms || selectedPlatforms.length === 0 || !!savedRuleSuccess}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {savedRuleSuccess ? "Rule Saved" : "Scheduled Save Disabled"}
                    </Button>
                  </div>

                  {/* Preview output */}
                  <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-white font-semibold">Rule Preview</div>
                      <div className="text-xs text-gray-400">
                        Status:{" "}
                        <span className="text-gray-200 font-semibold">
                          {previewStatus.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-gray-300">
                      {previewResult?.reason ? (
                        <>
                          <span className="text-gray-400">Note:</span> <span className="text-gray-200">{String(previewResult.reason)}</span>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </div>

                    {showDetails && (previewResult?.payload || previewResult?.diagnostics) && (
                      <div className="mt-3 rounded-xl border border-gray-800 bg-black/40 p-3">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Rule Details</div>
                        {previewResult?.payload && (
                          <pre className="max-h-60 overflow-auto text-xs text-gray-200">
                            {JSON.stringify(previewResult.payload, null, 2)}
                          </pre>
                        )}
                        {previewResult?.diagnostics && (
                          <pre className="mt-3 max-h-60 overflow-auto border-t border-gray-800 pt-3 text-xs text-gray-200">
                            {JSON.stringify(previewResult.diagnostics, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {tab === "platforms" && (
            <motion.div
              key="platforms"
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
                    Open Creator Platforms
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Use these links to open your creator platforms and complete posting.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs leading-5 text-cyan-100">
                    Launch mode: Scheduled Autopost platform availability is gated by server status. External links open platform websites only; they do not indicate account connection.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {platforms.map(p => {
                      const url = p.external_url ?? platformUrl(p.id)
                      const selectable = isPlatformSelectable(p)

                      return (
                        <div key={p.id} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-white font-semibold">{p.name}</div>
                              <div className="mt-1 text-xs text-gray-400">
                                {selectable ? "Available for Scheduled Autopost." : platformUnavailableMessage(p)}
                              </div>
                              {p.reason && <div className="text-xs text-gray-500 mt-1">{p.reason}</div>}
                              <div className="mt-2 inline-flex rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-300">
                                {String(p.launch_status ?? "coming_soon").replace("_", " ")}
                              </div>
                            </div>
                            {url ? (
                              <Button asChild className="bg-cyan-600 hover:bg-cyan-500">
                                <a href={url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-4 h-4 mr-2" />
                                  Open platform
                                </a>
                              </Button>
                            ) : (
                              <Button disabled className="bg-gray-800 text-gray-300 disabled:opacity-60">
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Unavailable
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
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
                    <span>I understand this rule helps prepare my posting workflow, and final posting may be completed directly on each platform.</span>
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
