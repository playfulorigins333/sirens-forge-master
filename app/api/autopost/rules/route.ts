import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { normalizeKnownPlatformIds } from "@/lib/autopost/platformRegistry"
import { buildXTextContentPayload } from "@/lib/autopost/contentPayload"
import { validateXDraftSchedule } from "@/lib/autopost/schedule"

function normalizeExplicitness(value: unknown) {
  const explicitness = Number(value)
  if (!Number.isFinite(explicitness)) return 3

  return Math.max(1, Math.min(5, Math.floor(explicitness)))
}

function normalizeTones(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .filter((tone): tone is string => typeof tone === "string")
    .map((tone) => tone.trim())
    .filter(Boolean)
}

export async function GET() {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("autopost_rules")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    rules: data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 })
  }

  const ruleInput = body as Record<string, unknown>

  const knownPlatforms = normalizeKnownPlatformIds(ruleInput.selected_platforms)
  if (knownPlatforms.length === 0) {
    return NextResponse.json({ error: "NO_VALID_PLATFORMS" }, { status: 400 })
  }

  // Draft preparation is intentionally separate from scheduled posting availability.
  // Pass 5E allows only X text-only DRAFT persistence while X remains non-selectable
  // and non-runnable for scheduled Autopost.
  if (knownPlatforms.length !== 1 || knownPlatforms[0] !== "x") {
    return NextResponse.json({ error: "NO_AVAILABLE_PLATFORMS" }, { status: 400 })
  }

  const contentResult = buildXTextContentPayload(ruleInput)
  if ("error" in contentResult) {
    return NextResponse.json({ error: contentResult.error }, { status: 400 })
  }

  const scheduleResult = validateXDraftSchedule(ruleInput)
  if ("error" in scheduleResult) {
    return NextResponse.json({ error: scheduleResult.error }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: connectedAccount, error: accountError } = await supabase
    .from("autopost_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("platform", "x")
    .eq("connection_status", "CONNECTED")
    .maybeSingle()

  if (accountError) {
    return NextResponse.json({ error: "X_ACCOUNT_LOOKUP_FAILED" }, { status: 500 })
  }

  if (!connectedAccount) {
    return NextResponse.json({ error: "X_ACCOUNT_NOT_CONNECTED" }, { status: 400 })
  }

  const insertRule = {
    user_id: userId,
    enabled: false,
    selected_platforms: ["x"],
    content_payload: contentResult.payload,
    explicitness: normalizeExplicitness(ruleInput.explicitness),
    tones: normalizeTones(ruleInput.tones),
    timezone: scheduleResult.schedule.timezone,
    start_date: scheduleResult.schedule.start_date,
    end_date: scheduleResult.schedule.end_date,
    posts_per_day: scheduleResult.schedule.posts_per_day,
    time_slots: scheduleResult.schedule.time_slots,
    approval_state: "DRAFT",
    approved_at: null,
    paused_at: null,
    revoked_at: null,
    accept_split: false,
    accept_automation: false,
    accept_control: false,
    creator_pct: 80,
    platform_pct: 20,
    next_run_at: null,
    last_run_at: null,
  }

  const { data, error } = await supabase
    .from("autopost_rules")
    .insert(insertRule)
    .select("*")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: "INSERT_FAILED", details: error?.message ?? null },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    rule: data,
  })
}
