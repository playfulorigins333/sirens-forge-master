import { NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabaseServer"

export async function POST() {
  try {
    const supabase = await supabaseServer()

    await supabase.auth.signOut()

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("LOGOUT ERROR:", err)
    return NextResponse.json({ error: "Logout failed" }, { status: 500 })
  }
}