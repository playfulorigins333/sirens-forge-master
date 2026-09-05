import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import {
  filterSelectableAutopostPlatformIds,
  normalizeKnownPlatformIds,
} from "@/lib/autopost/platformRegistry"

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

  const entitlement = await ensureActiveSubscription()
  if (!entitlement.ok || !entitlement.user?.id) {
    return NextResponse.json(
      { error: entitlement.error ?? "NO_ACTIVE_SUBSCRIPTION" },
      { status: entitlement.status ?? 402 }
    )
  }
  const userId = entitlement.user.id

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

  const { data: existingRule, error: fetchError } = await supabaseAdmin
    .from("autopost_rules")
    .select("selected_platforms")
    .eq("id", rule_id)
    .eq("user_id", userId)
    .single()

  if (fetchError || !existingRule) {
    return NextResponse.json(
      { error: fetchError?.message ?? "RULE_NOT_FOUND" },
      { status: 404 }
    )
  }

  const knownPlatforms = normalizeKnownPlatformIds(existingRule.selected_platforms)
  const selectablePlatforms = filterSelectableAutopostPlatformIds(knownPlatforms)

  if (selectablePlatforms.length === 0) {
    return NextResponse.json(
      { error: "NO_AVAILABLE_PLATFORMS" },
      { status: 400 }
    )
  }

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
