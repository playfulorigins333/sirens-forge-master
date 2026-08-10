import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  return NextResponse.json(
    {
      error: "LEGACY_LORA_ENDPOINT_DISABLED",
      message:
        "This legacy LoRA endpoint is disabled. Use the current LoRA training flow.",
    },
    { status: 410 }
  )
}
