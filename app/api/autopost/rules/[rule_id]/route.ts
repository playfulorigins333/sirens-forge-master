// app/api/autopost/rules/[rule_id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ rule_id?: string }>
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL")
  if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY")

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    // ✅ Next.js 16: params is a Promise for dynamic routes in App Router
    const { rule_id } = await ctx.params

    if (!rule_id) {
      return NextResponse.json({ error: "Missing rule_id" }, { status: 400 })
    }

    if (!isUuid(rule_id)) {
      return NextResponse.json({ error: "Invalid rule_id (must be UUID)" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("autopost_rules")
      .select("*")
      .eq("id", rule_id)
      .single()

    if (error) {
      // Supabase returns a "Row not found" style error on .single() when empty
      const msg = (error as any)?.message || "Failed to fetch rule"
      const code = (error as any)?.code

      if (code === "PGRST116" || /0 rows|No rows|not found/i.test(msg)) {
        return NextResponse.json({ error: "Rule not found" }, { status: 404 })
      }

      return NextResponse.json(
        { error: "Supabase error", details: msg, code: code ?? null },
        { status: 500 }
      )
    }

    return NextResponse.json({ rule: data }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unhandled error", details: e?.message ?? String(e) },
      { status: 500 }
    )
  }
}
