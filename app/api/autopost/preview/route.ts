import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin()

  const body = await req.json().catch(() => null)

  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    )
  }

  // This is a SAFE preview endpoint — no writes
  return NextResponse.json({
    preview: {
      message: "Preview generated successfully",
      input: body,
    },
  })
}
