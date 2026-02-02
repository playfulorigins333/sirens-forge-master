"use client"

import { useEffect, useState } from "react"
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
} from "lucide-react"
import { motion } from "framer-motion"

export default function AffiliateDashboard() {
  const supabase = supabaseBrowser()

  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [tierName, setTierName] = useState<string>("Standard")
  const [code, setCode] = useState<string>("")
  const [summary, setSummary] = useState<any>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [payouts, setPayouts] = useState<any[]>([])

  useEffect(() => {
    loadAffiliateData()
  }, [])

  async function loadAffiliateData() {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const { data: p } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()

    setProfile(p)

    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("tier_name")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    setTierName(sub?.tier_name ?? "Standard")

    const { data: codeData } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", user.id)
      .maybeSingle()

    setCode(codeData?.code || "")

    const { data: summaryData } = await supabase.rpc(
      "get_user_stats",
      { user_id_input: user.id }
    )

    setSummary(summaryData)

    const { data: recent } = await supabase
      .from("affiliate_commissions")
      .select("*")
      .eq("affiliate_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25)

    setActivity(recent || [])

    const { data: payoutItems } = await supabase
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

    setPayouts(payoutItems || [])

    setLoading(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(
      `https://sirensforge.vip?ref=${code}`
    )
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

  const stripeConnected = Boolean(profile?.stripe_connect_onboarded)

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-900 to-black text-white px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-14"
      >
        <h1 className="text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
          Affiliate Empire
        </h1>
        <p className="text-gray-300 mt-3 text-xl">
          Your influence powers the Forge.
        </p>
      </motion.div>

      {!stripeConnected ? (
        <Card className="border-amber-500/40 bg-amber-500/10 mb-12">
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
        <Card className="border-emerald-500/40 bg-emerald-500/10 mb-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-emerald-200">
              <CheckCircle className="w-6 h-6" />
              Stripe Connected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-emerald-100 text-sm">
              Your Stripe account is connected. Commissions are routed directly
              to you.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
