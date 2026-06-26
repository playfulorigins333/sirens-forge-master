import { NextResponse } from "next/server"
import { getPublicAutopostPlatforms } from "@/lib/autopost/platformRegistry"

export async function GET() {
  return NextResponse.json({
    platforms: getPublicAutopostPlatforms(),
  })
}
