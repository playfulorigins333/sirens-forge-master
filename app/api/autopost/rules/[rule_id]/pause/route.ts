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

    // Allowed states
    if (!["DRAFT", "APPROVED"].includes(rule.approval_state)) {
      return NextResponse.json(
        { error: "Rule cannot be paused from current state" },
        { status: 400 }
      )
    }

    const { data: updatedRule, error: updateError } = await supabaseAdmin
      .from("autopost_rules")
      .update({
        enabled: false,
        approval_state: "PAUSED",
        paused_at: new Date().toISOString(),
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

    return NextResponse.json({ rule: updatedRule })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Unexpected error" },
      { status: 500 }
    )
  }
}
