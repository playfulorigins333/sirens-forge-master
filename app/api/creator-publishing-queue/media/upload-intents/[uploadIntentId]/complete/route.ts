import { NextResponse } from "next/server"

const disabledUploadResponse = { "Cache-Control": "no-store" }

export async function POST() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: disabledUploadResponse })
}
