import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(
  _req: Request,
  context: { params: Promise<{ rule_id: string }> }
) {
  try {
    // ✅ Next.js 16 FIX — params is a Promise
    const { rule_id } = await context.params

    if (!rule_id) {
      return NextResponse.json(
        { error: "Missing rule_id" },
        { status: 400 }
      )
    }

    const userId = process.env.DEV_BYPASS_USER_ID

    if (!userId) {
      return NextResponse.json(
        { error: "DEV_BYPASS_USER_ID not set" },
        { status: 500 }
      )
    }

    const supabase = getSupabaseAdmin()

    // 🔍 Verify rule belongs to this user
    const { data: rule, error: fetchError } = await supabase
      .from("autopost_rules")
      .select("*")
      .eq("id", rule_id)
      .eq("user_id", userId)
      .single()

    if (fetchError || !rule) {
      return NextResponse.json(
        { error: "Rule not found or not owned by user" },
        { status: 404 }
      )
    }

    // ✅ Approve rule
    const { data: updatedRule, error: updateError } = await supabase
      .from("autopost_rules")
      .update({
        approval_state: "APPROVED",
        approved_at: new Date().toISOString(),
        enabled: true,
      })
      .eq("id", rule_id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { rule: updatedRule },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    )
  }
}
