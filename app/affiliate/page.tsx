"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Crown,
  Star,
  Users,
  DollarSign,
  Copy,
  Zap,
  TrendingUp,
  Gift,
  ArrowRight,
} from "lucide-react"
import { motion } from "framer-motion"

export default function AffiliateDashboard() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
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
    const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).single()
    setProfile(p)

    // REFERRAL CODE
    const { data: codeData } = await supabase.from("referral_codes").select("*").eq("user_id", user.id).maybeSingle()
    setCode(codeData?.code || "")

    // SUMMARY
    const { data: summaryData } = await supabase.rpc("get_user_stats", { user_id_input: user.id })
    setSummary(summaryData)

    // ACTIVITY
    const { data: recent } = await supabase
      .from("commission_earnings")
      .select("*, referral_codes(code), referred_user_id")
      .eq("referrer_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25)

    setActivity(recent || [])

    // PAYOUTS
    const { data: payoutsData } = await supabase
      .from("payouts")
      .select("*")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false })

    setPayouts(payoutsData || [])

    setLoading(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(`https://sirensforge.vip?ref=${code}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white text-xl animate-pulse">
        Loading your affiliate empire…
      </div>
    )
  }

  // ---- TIER BADGE LOGIC ----
  const tierName =
    profile?.tier === "og"
      ? "OG Founder"
      : profile?.tier === "early_bird"
      ? "Early Bird"
      : profile?.tier === "prime"
      ? "Prime Access"
      : "Standard"

  const tierColors: Record<string, string> = {
    "OG Founder": "from-yellow-300 to-orange-500",
    "Early Bird": "from-purple-400 to-pink-500",
    "Prime Access": "from-cyan-400 to-blue-500",
    "Standard": "from-gray-600 to-gray-800",
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-900 to-black text-white px-6 py-12">
      {/* PAGE HEADER */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-14"
      >
        <h1 className="text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent drop-shadow-xl">
          Affiliate Empire
        </h1>
        <p className="text-gray-300 mt-3 text-xl">
          Your influence powers the Forge. Your success builds the kingdom.
        </p>
      </motion.div>

      {/* TIER BADGE */}
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`mx-auto mb-12 px-8 py-4 rounded-full w-fit text-2xl font-bold shadow-xl bg-gradient-to-r ${tierColors[tierName]}`}
      >
        {tierName} 👑
      </motion.div>

      {/* STATS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-14">
        <StatCard
          icon={<Users className="w-9 h-9 text-purple-300" />}
          label="Total Referrals"
          value={summary?.total_referrals || 0}
        />
        <StatCard
          icon={<TrendingUp className="w-9 h-9 text-green-300" />}
          label="Active Subscribers"
          value={summary?.active_subscribers || 0}
        />
        <StatCard
          icon={<DollarSign className="w-9 h-9 text-yellow-300" />}
          label="Total Earned"
          value={`$${summary?.total_earned?.toFixed(2) || "0.00"}`}
        />
        <StatCard
          icon={<Gift className="w-9 h-9 text-pink-300" />}
          label="Pending Payouts"
          value={`$${summary?.pending_payout?.toFixed(2) || "0.00"}`}
        />
      </div>

      {/* REFERRAL LINK */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="bg-gray-900/60 border-gray-700 shadow-xl mb-16">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-3xl">
              <Crown className="w-9 h-9 text-yellow-400 animate-pulse" />
              Your Referral Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-5 bg-black/40 rounded-lg border border-gray-700 flex items-center justify-between">
              <code className="text-xl text-purple-300">{`https://sirensforge.vip?ref=${code}`}</code>
              <Button onClick={copyLink} className="flex gap-2 bg-purple-600 hover:bg-purple-700 text-white">
                <Copy className="w-5 h-5" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ACTIVITY FEED */}
      <Section title="Recent Activity">
        {activity.length === 0 ? (
          <EmptyMessage message="No referrals yet — the empire awaits your command." />
        ) : (
          <div className="space-y-4">
            {activity.map((a, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-gray-900/40 border border-gray-700 p-4 rounded-lg flex justify-between shadow-md"
              >
                <span className="text-gray-300">
                  Referral earned:
                  <span className="text-green-400 font-bold">
                    {" "}
                    ${a.commission_amount}
                  </span>
                </span>
                <span className="text-sm text-gray-500">
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </Section>

      {/* PAYOUT HISTORY */}
      <Section title="Payout History">
        {payouts.length === 0 ? (
          <EmptyMessage message="No payouts yet — keep building your reign." />
        ) : (
          <div className="space-y-4">
            {payouts.map((p, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-gray-900/40 border border-gray-700 p-4 rounded-lg flex justify-between shadow-md"
              >
                <span className="text-gray-300">
                  ${p.amount} — {p.status}
                </span>
                <span className="text-sm text-gray-500">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

/* ---------------- COMPONENTS ---------------- */

function StatCard({ icon, label, value }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="bg-gray-900/70 border-gray-700 shadow-lg hover:shadow-purple-500/20 transition-all">
        <CardContent className="p-6 text-center space-y-4">
          <div className="flex justify-center">{icon}</div>
          <div className="text-gray-300 text-lg">{label}</div>
          <div className="text-4xl font-extrabold bg-gradient-to-r from-purple-400 to-pink-400 text-transparent bg-clip-text">
            {value}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function Section({ title, children }: any) {
  return (
    <div className="mb-16">
      <h2 className="text-4xl font-bold mb-6 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
        {title}
      </h2>
      {children}
    </div>
  )
}

function EmptyMessage({ message }: any) {
  return <p className="text-gray-400 text-center py-8">{message}</p>
}
