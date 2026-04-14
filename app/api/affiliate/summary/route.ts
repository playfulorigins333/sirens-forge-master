import { NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabaseServer"

export async function GET(_req: Request) {
  try {
    const supabase = await supabaseServer()

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = user.id

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("referral_code, tier, email")
      .eq("user_id", userId)
      .single()

    if (profileErr) throw profileErr

    const { data: referrals, error: referralErr } = await supabase
      .from("referrals")
      .select("referred_user_id, status")
      .eq("referrer_user_id", userId)

    if (referralErr) throw referralErr

    const { data: commissions, error: commissionErr } = await supabase
      .from("commission_earnings")
      .select("*")
      .eq("referrer_user_id", userId)

    if (commissionErr) throw commissionErr

    const safeCommissions = commissions || []
    const safeReferrals = referrals || []

    const paidEarnings = safeCommissions
      .filter((c) => c.status === "paid")
      .reduce((acc, c) => acc + Number(c.commission_amount || 0), 0)

    const pendingEarnings = safeCommissions
      .filter((c) => c.status === "pending")
      .reduce((acc, c) => acc + Number(c.commission_amount || 0), 0)

    const totalEarnings = paidEarnings

    const { data: codeData, error: codeErr } = await supabase
      .from("referral_codes")
      .select("total_uses")
      .eq("user_id", userId)
      .maybeSingle()

    if (codeErr) throw codeErr

    const clicks = codeData?.total_uses || 0

    return NextResponse.json({
      referral_code: profile.referral_code,
      tier: profile.tier,
      total_referrals: safeReferrals.length,
      referrals: safeReferrals,
      total_earnings: totalEarnings,
      pending: pendingEarnings,
      paid: paidEarnings,
      clicks,
      commissions: safeCommissions,
    })
  } catch (err: any) {
    console.error("AFFILIATE SUMMARY ERROR:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}