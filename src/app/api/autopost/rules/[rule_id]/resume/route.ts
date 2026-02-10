import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ rule_id: string }> }
) {
  try {
    const { rule_id } = await params

    if (!rule_id) {
      return NextResponse.json(
        { error: "Missing rule_id" },
        { status: 400 }
      )
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Fetch rule
    const { data: rule, error: fetchError } = await supabaseAdmin
      .from("autopost_rules")
      .select("*")
      .eq("id", rule_id)
      .single()

    if (fetchError || !rule) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      )
    }

    // Resume rule
    const { data: updatedRule, error: updateError } = await supabaseAdmin
      .from("autopost_rules")
      .update({
        enabled: true,
        approval_state: "APPROVED",
        paused_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule_id)
      .select("*")
      .single()

    if (updateError || !updatedRule) {
      return NextResponse.json(
        { error: "Failed to resume rule" },
        { status: 500 }
      )
    }

    return NextResponse.json({ rule: updatedRule })
  } catch (err) {
    console.error("RESUME RULE ERROR:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
