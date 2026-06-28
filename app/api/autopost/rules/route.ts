import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { normalizeKnownPlatformIds } from "@/lib/autopost/platformRegistry"
import { buildFanvueDraftContentPayload, buildXTextContentPayload } from "@/lib/autopost/contentPayload"
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

  if (knownPlatforms.length !== 1 || !["x", "fanvue"].includes(knownPlatforms[0])) {
    return NextResponse.json({ error: "NO_AVAILABLE_PLATFORMS" }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const platform = knownPlatforms[0]
  let contentPayload: Record<string, unknown>
  let schedule = {
    timezone: "UTC",
    start_date: null as string | null,
    end_date: null as string | null,
    // Keep non-runnable draft inserts compatible with the existing rule
    // scheduling contract. Runtime eligibility remains blocked by DRAFT,
    // enabled=false, and next_run_at=null.
    posts_per_day: 1,
    time_slots: ["00:00"] as string[],
  }

  if (platform === "x") {
    const contentResult = buildXTextContentPayload(ruleInput)
    if ("error" in contentResult) {
      return NextResponse.json({ error: contentResult.error }, { status: 400 })
    }

    const scheduleResult = validateXDraftSchedule(ruleInput)
    if ("error" in scheduleResult) {
      return NextResponse.json({ error: scheduleResult.error }, { status: 400 })
    }

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

    contentPayload = contentResult.payload
    schedule = scheduleResult.schedule
  } else {
    const contentResult = buildFanvueDraftContentPayload(ruleInput)
    if ("error" in contentResult) {
      return NextResponse.json({ error: contentResult.error }, { status: 400 })
    }
    contentPayload = contentResult.payload
  }

  const insertRule = {
    user_id: userId,
    enabled: false,
    selected_platforms: [platform],
    content_payload: contentPayload,
    explicitness: normalizeExplicitness(ruleInput.explicitness),
    tones: normalizeTones(ruleInput.tones),
    timezone: schedule.timezone,
    start_date: schedule.start_date,
    end_date: schedule.end_date,
    posts_per_day: schedule.posts_per_day,
    time_slots: schedule.time_slots,
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
