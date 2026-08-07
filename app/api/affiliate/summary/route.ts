import { NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

type SummaryDependencies = {
  getAuthenticatedUserId(): Promise<string | null>
  getAdminClient(): any
}
const noStore = { "Cache-Control": "no-store" }
const failure = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore })

export async function affiliateSummaryResponse(deps: SummaryDependencies) {
  let userId: string | null
  try { userId = await deps.getAuthenticatedUserId() } catch { return failure(401, "Unauthorized") }
  if (!userId) return failure(401, "Unauthorized")
  try {
    const admin = deps.getAdminClient()
    const rows = async (query: PromiseLike<any>) => { const { data, error } = await query; if (error || !Array.isArray(data)) throw new Error(); return data }
    const profiles = await rows(admin.from("profiles").select("id,user_id,referral_code,tier,stripe_connect_onboarded").eq("user_id", userId).limit(2))
    if (profiles.length !== 1 || !profiles[0]?.id || profiles[0].user_id !== userId) return failure(409, "Affiliate profile is unavailable")
    const profile = profiles[0]
    const subscriptions = await rows(admin.from("user_subscriptions").select("tier_name,status,created_at").eq("user_id", profile.id).eq("status", "active").order("created_at", { ascending: false }).limit(1))
    const referrals = await rows(admin.from("referrals").select("referred_user_id,used_at,status").eq("referrer_user_id", userId))
    const commissions = await rows(admin.from("commission_earnings").select("id,commission_amount,status,created_at,payout_date,referred_user_id,referral_id").eq("referrer_user_id", userId))
    const codes = await rows(admin.from("referral_codes").select("total_uses,user_id").eq("user_id", userId).limit(2))
    if (codes.length > 1 || (codes[0] && codes[0].user_id !== userId)) return failure(409, "Affiliate profile is unavailable")
    const payouts = await rows(admin.from("affiliate_payout_items").select("amount_cents,created_at,affiliate_payout_batches(status,created_at)").eq("affiliate_user_id", userId).order("created_at", { ascending: false }).limit(10))
    const paid = commissions.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.commission_amount || 0), 0)
    const pending = commissions.filter((row: any) => row.status === "pending").reduce((sum: number, row: any) => sum + Number(row.commission_amount || 0), 0)
    return NextResponse.json({
      referral_code: typeof profile.referral_code === "string" ? profile.referral_code : null,
      tier: subscriptions[0]?.tier_name ?? profile.tier ?? null,
      stripe_connect_onboarded: profile.stripe_connect_onboarded === true,
      total_referrals: referrals.length, referrals, commissions, total_earnings: paid, pending, paid,
      clicks: Number(codes[0]?.total_uses || 0), payouts,
    }, { headers: noStore })
  } catch { return failure(500, "Unable to load affiliate history") }
}

export async function GET() {
  return affiliateSummaryResponse({
    async getAuthenticatedUserId() { const auth = await supabaseServer(); const { data, error } = await auth.auth.getUser(); return error ? null : data.user?.id ?? null },
    getAdminClient: getSupabaseAdmin,
  })
}
