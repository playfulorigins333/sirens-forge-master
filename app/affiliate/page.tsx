"use client"

import { useEffect, useMemo, useState } from "react"
import { supabaseBrowser } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Crown,
  Users,
  DollarSign,
  Copy,
  TrendingUp,
  Gift,
  AlertTriangle,
  Link as LinkIcon,
  CheckCircle,
  Loader2,
  Clock3,
} from "lucide-react"
import { motion } from "framer-motion"

type AffiliateSummary = {
  referral_code: string | null
  tier: string | null
  total_referrals: number
  referrals: Array<{
    referred_user_id: string
    used_at: string | null
    status: string | null
  }>
  total_earnings: number
  pending: number
  paid: number
  clicks: number
  commissions: Array<{
    id?: string
    commission_amount?: number | string | null
    status?: string | null
    created_at?: string | null
    payout_date?: string | null
    referred_user_id?: string | null
    referral_id?: string | null
  }>
}

type PayoutBatch = {
  status?: string | null
  created_at?: string | null
}

type PayoutItem = {
  amount_cents?: number | null
  created_at?: string | null
  affiliate_payout_batches?: PayoutBatch[] | null
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString()
}

function prettifyTier(value?: string | null) {
  if (!value) return "Standard"
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function prettifyStatus(value?: string | null) {
  if (!value) return "Unknown"
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function statusClasses(status?: string | null) {
  const normalized = String(status || "").toLowerCase()

  if (normalized === "paid") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
  }

  if (normalized === "pending") {
    return "border-amber-500/30 bg-amber-500/15 text-amber-300"
  }

  if (normalized === "approved") {
    return "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
  }

  return "border-gray-700 bg-gray-800/70 text-gray-300"
}

function MetricCard(props: {
  icon: React.ReactNode
  title: string
  value: string
  subtext?: string
}) {
  return (
    <Card className="border-gray-700 bg-gray-800/60 backdrop-blur-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              {props.title}
            </p>
            <p className="mt-2 text-3xl font-bold text-white">{props.value}</p>
            {props.subtext ? (
              <p className="mt-2 text-xs text-gray-400">{props.subtext}</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
            {props.icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AffiliateDashboard() {
  const supabase = supabaseBrowser()

  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)

  const [profile, setProfile] = useState<any>(null)
  const [tierName, setTierName] = useState<string>("Standard")
  const [summary, setSummary] = useState<AffiliateSummary | null>(null)
  const [payouts, setPayouts] = useState<PayoutItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle")

  useEffect(() => {
    loadAffiliateData()
  }, [])

  async function loadAffiliateData() {
    setLoading(true)
    setError(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in to view affiliate details.")
        setLoading(false)
        return
      }

      const { data: p, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single()

      if (profileError) throw profileError
      setProfile(p)

      const { data: sub } = await supabase
        .from("user_subscriptions")
        .select("tier_name")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      setTierName(sub?.tier_name ?? p?.tier ?? "Standard")

      const summaryRes = await fetch("/api/affiliate/summary", {
        method: "GET",
        credentials: "include",
      })

      const summaryJson = await summaryRes.json()

      if (!summaryRes.ok) {
        throw new Error(summaryJson?.error || "Unable to load affiliate summary")
      }

      setSummary(summaryJson)

      const { data: payoutItems, error: payoutError } = await supabase
        .from("affiliate_payout_items")
        .select(`
          amount_cents,
          created_at,
          affiliate_payout_batches (
            status,
            created_at
          )
        `)
        .eq("affiliate_user_id", user.id)
        .order("created_at", { ascending: false })

      if (payoutError) throw payoutError
      setPayouts((payoutItems || []) as PayoutItem[])
    } catch (err: any) {
      setError(err?.message ?? "Failed to load affiliate dashboard.")
    } finally {
      setLoading(false)
    }
  }

  const referralCode = summary?.referral_code || ""
  const referralLink = referralCode
    ? `https://sirensforge.vip?ref=${referralCode}`
    : ""

  const stripeConnected = Boolean(profile?.stripe_connect_onboarded)

  const recentCommissions = useMemo(() => {
    return [...(summary?.commissions || [])]
      .sort((a, b) => {
        const at = new Date(a.created_at || 0).getTime()
        const bt = new Date(b.created_at || 0).getTime()
        return bt - at
      })
      .slice(0, 10)
  }, [summary])

  function copyLink() {
    if (!referralLink) return
    navigator.clipboard.writeText(referralLink)
    setCopyState("copied")
    window.setTimeout(() => setCopyState("idle"), 1600)
  }

  async function handleConnectStripe() {
    try {
      setConnecting(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error("Not authenticated")
      }

      const res = await fetch("/api/stripe/connect/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      })

      const json = await res.json()

      if (!res.ok || !json?.url) {
        throw new Error(json?.error || "Unable to start Stripe onboarding")
      }

      window.location.href = json.url
    } catch (err: any) {
      alert(err?.message ?? "Stripe Connect unavailable. Try again later.")
      setConnecting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white text-xl animate-pulse">
        Loading your affiliate empire…
      </div>
    )
  }

  const tierColors: Record<string, string> = {
    og_throne: "from-yellow-300 to-orange-500",
    early_bird: "from-purple-400 to-pink-500",
    prime_access: "from-cyan-400 to-blue-500",
    Standard: "from-gray-600 to-gray-800",
  }

  const tierGradient = tierColors[tierName] || tierColors.Standard

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-900 to-black text-white px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-7xl"
      >
        <div className="mb-12 text-center">
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Affiliate Empire
          </h1>
          <p className="text-gray-300 mt-3 text-lg md:text-xl">
            Track referrals, commissions, and payouts from one place.
          </p>

          <div className={`mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r ${tierGradient} px-4 py-2 text-sm font-bold text-white shadow-lg`}>
            <Crown className="w-4 h-4" />
            {prettifyTier(tierName)}
          </div>
        </div>

        {error ? (
          <Card className="border-rose-500/40 bg-rose-500/10 mb-10">
            <CardContent className="p-5">
              <p className="text-rose-200 text-sm">{error}</p>
            </CardContent>
          </Card>
        ) : null}

        {!stripeConnected ? (
          <Card className="border-amber-500/40 bg-amber-500/10 mb-10">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-amber-200">
                <AlertTriangle className="w-6 h-6" />
                Earnings Locked — Action Required
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-amber-100 text-sm">
                Stripe Connect is required so commissions are paid directly to you.
              </p>
              <Button
                onClick={handleConnectStripe}
                disabled={connecting}
                className="flex items-center gap-2"
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-4 h-4" />
                    Connect Stripe
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-500/40 bg-emerald-500/10 mb-10">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-emerald-200">
                <CheckCircle className="w-6 h-6" />
                Stripe Connected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-emerald-100 text-sm">
                Your Stripe account is connected. Commissions are routed directly to you.
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="border-gray-700 bg-gray-800/60 backdrop-blur-sm mb-10">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-white">
              <Gift className="w-5 h-5 text-pink-400" />
              Your Referral Link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500 mb-2">
                Referral Code
              </div>
              <div className="text-lg font-semibold text-white">
                {referralCode || "No referral code found"}
              </div>
            </div>

            <div className="rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3 break-all">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500 mb-2">
                Share Link
              </div>
              <div className="text-sm text-gray-200">
                {referralLink || "No referral link available"}
              </div>
            </div>

            <Button
              onClick={copyLink}
              disabled={!referralLink}
              className="flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              {copyState === "copied" ? "Copied" : "Copy Referral Link"}
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5 mb-10">
          <MetricCard
            icon={<Users className="w-5 h-5" />}
            title="Referrals"
            value={String(summary?.total_referrals ?? 0)}
            subtext="People you brought into the Forge"
          />
          <MetricCard
            icon={<TrendingUp className="w-5 h-5" />}
            title="Clicks / Uses"
            value={String(summary?.clicks ?? 0)}
            subtext="Referral code usage tracked so far"
          />
          <MetricCard
            icon={<DollarSign className="w-5 h-5" />}
            title="Total Earnings"
            value={formatCurrency(Number(summary?.total_earnings ?? 0))}
          />
          <MetricCard
            icon={<Clock3 className="w-5 h-5" />}
            title="Pending"
            value={formatCurrency(Number(summary?.pending ?? 0))}
            subtext="Awaiting payout or processing"
          />
          <MetricCard
            icon={<CheckCircle className="w-5 h-5" />}
            title="Paid"
            value={formatCurrency(Number(summary?.paid ?? 0))}
            subtext="Already paid out"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-gray-700 bg-gray-800/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Recent Commission Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {recentCommissions.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No commission activity yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {recentCommissions.map((item, index) => {
                    const amount = Number(item.commission_amount || 0)
                    return (
                      <div
                        key={`${item.id || index}-${item.created_at || index}`}
                        className="rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {formatCurrency(amount)}
                            </div>
                            <div className="mt-1 text-xs text-gray-400">
                              {formatDateTime(item.created_at)}
                            </div>
                          </div>

                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(
                              item.status
                            )}`}
                          >
                            {prettifyStatus(item.status)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-700 bg-gray-800/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Payout History</CardTitle>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No payout history yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {payouts.slice(0, 10).map((item, index) => {
                    const amount = Number(item.amount_cents || 0) / 100
                    const batch = item.affiliate_payout_batches?.[0]
                    const payoutStatus = batch?.status || "unknown"

                    return (
                      <div
                        key={`${index}-${item.created_at || "payout"}`}
                        className="rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {formatCurrency(amount)}
                            </div>
                            <div className="mt-1 text-xs text-gray-400">
                              {formatDate(item.created_at)}
                            </div>
                          </div>

                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(
                              payoutStatus
                            )}`}
                          >
                            {prettifyStatus(payoutStatus)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  )
}