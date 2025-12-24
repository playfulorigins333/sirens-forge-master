import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST() {
  try {
    const supabase = getSupabaseAdmin()
    const now = new Date().toISOString()

    // Fetch candidate rules
    const { data: rules, error } = await supabase
      .from("autopost_rules")
      .select("*")

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch rules", details: error.message },
        { status: 500 }
      )
    }

    const processed: any[] = []

    for (const rule of rules ?? []) {
      // 🔒 HARD SAFETY INVARIANT — DO NOT REMOVE
      if (rule.approval_state !== "APPROVED" || rule.enabled !== true) {
        continue
      }

      // ---- executor logic placeholder ----
      // (posting workers will live here later)

      const nextRun = null // scheduler will compute later

      await supabase
        .from("autopost_rules")
        .update({
          last_run_at: now,
          next_run_at: nextRun,
        })
        .eq("id", rule.id)

      processed.push({
        id: rule.id,
        user_id: rule.user_id,
        last_run_at: now,
        next_run_at: nextRun,
      })
    }

    return NextResponse.json({
      ran_at: now,
      processed: processed.length,
      rules: processed,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: "Executor crashed", details: err.message },
      { status: 500 }
    )
  }
}
