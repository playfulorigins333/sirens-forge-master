"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Crown,
  Users,
  DollarSign,
  Copy,
  TrendingUp,
  Gift,
} from "lucide-react"
import { motion } from "framer-motion"

export default function AffiliateDashboard() {
  const [loading, setLoading] = useState(true)
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

    // PROFILE
    const { data: p } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()

    setProfile(p)

    // ACTIVE SUBSCRIPTION → TIER BADGE
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("tier_name")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    setTierName(sub?.tier_name ?? "Standard")

    // REFERRAL CODE
    const { data: codeData } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", user.id)
      .maybeSingle()

    setCode(codeData?.code || "")

    // SUMMARY (RPC YOU ALREADY HAVE)
    const { data: summaryData } = await supabase.rpc(
      "get_user_stats",
      { user_id_input: user.id }
    )

    setSummary(summaryData)

    // COMMISSION ACTIVITY (LEDGER)
    const { data: recent } = await supabase
      .from("affiliate_commissions")
      .select("*")
      .eq("affiliate_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25)

    setActivity(recent || [])

    // PAYOUT HISTORY (BATCHED)
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-900 to-black text-white px-6 py-12">
      {/* HEADER */}
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

      {/* TIER BADGE */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`mx-auto mb-12 px-8 py-4 rounded-full w-fit text-2xl font-bold bg-gradient-to-r ${
          tierColors[tierName] || tierColors.Standard
        }`}
      >
        {tierName.replace("_", " ").toUpperCase()} 👑
      </motion.div>

      {/* STATS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-14">
        <StatCard
          icon={<Users className="w-8 h-8 text-purple-300" />}
          label="Total Referrals"
          value={summary?.total_referrals || 0}
        />
        <StatCard
          icon={<TrendingUp className="w-8 h-8 text-green-300" />}
          label="Active Subscribers"
          value={summary?.active_subscribers || 0}
        />
        <StatCard
          icon={<DollarSign className="w-8 h-8 text-yellow-300" />}
          label="Total Earned"
          value={`$${(summary?.total_earned ?? 0).toFixed(2)}`}
        />
        <StatCard
          icon={<Gift className="w-8 h-8 text-pink-300" />}
          label="Pending"
          value={`$${(summary?.pending_payout ?? 0).toFixed(2)}`}
        />
      </div>

      {/* REFERRAL LINK */}
      <Card className="bg-gray-900/60 border-gray-700 mb-16">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-3xl">
            <Crown className="w-8 h-8 text-yellow-400" />
            Your Referral Link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-5 bg-black/40 rounded-lg border border-gray-700 flex justify-between items-center">
            <code className="text-xl text-purple-300">
              https://sirensforge.vip?ref={code}
            </code>
            <Button onClick={copyLink}>Copy</Button>
          </div>
        </CardContent>
      </Card>

      {/* ACTIVITY */}
      <Section title="Recent Activity">
        {activity.length === 0 ? (
          <EmptyMessage message="No commissions yet." />
        ) : (
          activity.map((a, i) => (
            <div
              key={i}
              className="bg-gray-900/40 border border-gray-700 p-4 rounded-lg flex justify-between"
            >
              <span>
                Earned ${(a.commission_amount_cents / 100).toFixed(2)}
              </span>
              <span className="text-sm text-gray-500">
                {new Date(a.created_at).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </Section>

      {/* PAYOUTS */}
      <Section title="Payout History">
        {payouts.length === 0 ? (
          <EmptyMessage message="No payouts yet." />
        ) : (
          payouts.map((p, i) => (
            <div
              key={i}
              className="bg-gray-900/40 border border-gray-700 p-4 rounded-lg flex justify-between"
            >
              <span>
                ${(p.amount_cents / 100).toFixed(2)} —{" "}
                {p.affiliate_payout_batches?.status ?? "processing"}
              </span>
              <span className="text-sm text-gray-500">
                {new Date(p.created_at).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </Section>
    </div>
  )
}

/* ---------------- COMPONENTS ---------------- */

function StatCard({ icon, label, value }: any) {
  return (
    <Card className="bg-gray-900/70 border-gray-700 text-center p-6">
      <div className="flex justify-center mb-3">{icon}</div>
      <div className="text-gray-300">{label}</div>
      <div className="text-4xl font-bold mt-2">{value}</div>
    </Card>
  )
}

function Section({ title, children }: any) {
  return (
    <div className="mb-16">
      <h2 className="text-4xl font-bold mb-6">{title}</h2>
      {children}
    </div>
  )
}

function EmptyMessage({ message }: any) {
  return <p className="text-gray-400 text-center py-8">{message}</p>
}
