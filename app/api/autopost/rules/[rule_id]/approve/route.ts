import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

type ApproveBody = {
  accept_split: boolean
  accept_automation: boolean
  accept_control: boolean
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ rule_id: string }> }
) {
  const { rule_id } = await context.params

  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  if (!rule_id) {
    return NextResponse.json({ error: "MISSING_RULE_ID" }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as ApproveBody | null
  if (!body) {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 })
  }

  if (
    body.accept_split !== true ||
    body.accept_automation !== true ||
    body.accept_control !== true
  ) {
    return NextResponse.json({ error: "MISSING_ACKS" }, { status: 400 })
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from("autopost_rules")
    .update({
      approval_state: "APPROVED",
      approved_at: new Date().toISOString(),
      enabled: true,
    })
    .eq("id", rule_id)
    .eq("user_id", userId)
    .select("*")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "UPDATE_FAILED" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    rule: data,
  })
}
