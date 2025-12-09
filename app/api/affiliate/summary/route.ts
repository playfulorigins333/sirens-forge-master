import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(req: Request) {
  try {
    // 1️⃣ Get the logged-in user
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const userId = user.id

    // 2️⃣ Fetch profile (tier + referral code)
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("referral_code, tier, email")
      .eq("user_id", userId)
      .single()

    if (profileErr) throw profileErr

    // 3️⃣ Fetch referrals (people they brought in)
    const { data: referrals, error: referralErr } = await supabase
      .from("referrals")
      .select("referred_user_id, used_at, status")
      .eq("referrer_user_id", userId)

    if (referralErr) throw referralErr

    // 4️⃣ Fetch commission earnings (paid + pending)
    const { data: commissions, error: commissionErr } = await supabase
      .from("commission_earnings")
      .select("*")
      .eq("referrer_user_id", userId)

    if (commissionErr) throw commissionErr

    // Calculate earnings
    const totalEarnings = commissions.reduce((acc, c) => acc + Number(c.commission_amount || 0), 0)

    const pendingEarnings = commissions
      .filter(c => c.status === "pending")
      .reduce((acc, c) => acc + Number(c.commission_amount || 0), 0)

    const paidEarnings = commissions
      .filter(c => c.status === "paid")
      .reduce((acc, c) => acc + Number(c.commission_amount || 0), 0)

    // 5️⃣ Pull total clicks from referral_codes metadata (if you're tracking)
    const { data: codeData } = await supabase
      .from("referral_codes")
      .select("total_uses")
      .eq("user_id", userId)
      .single()

    const clicks = codeData?.total_uses || 0

    // 6️⃣ Build the API response object
    return NextResponse.json({
      referral_code: profile.referral_code,
      tier: profile.tier,
      total_referrals: referrals.length,
      referrals,
      total_earnings: totalEarnings,
      pending: pendingEarnings,
      paid: paidEarnings,
      clicks,
      commissions,
    })
  } catch (err: any) {
    console.error("AFFILIATE SUMMARY ERROR:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
