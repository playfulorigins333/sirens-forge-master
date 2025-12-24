import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function GET() {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("autopost_rules")
    .select("*")
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
