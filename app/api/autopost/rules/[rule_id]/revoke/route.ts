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

    // Prevent double revoke
    if (rule.approval_state === "REVOKED") {
      return NextResponse.json(
        { error: "Rule already revoked" },
        { status: 409 }
      )
    }

    // Revoke rule (terminal)
    const { data: updatedRule, error: updateError } = await supabaseAdmin
      .from("autopost_rules")
      .update({
        enabled: false,
        approval_state: "REVOKED",
        revoked_at: new Date().toISOString(),
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule_id)
      .select("*")
      .single()

    if (updateError || !updatedRule) {
      return NextResponse.json(
        { error: "Failed to revoke rule" },
        { status: 500 }
      )
    }

    return NextResponse.json({ rule: updatedRule })
  } catch (err) {
    console.error("REVOKE RULE ERROR:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
