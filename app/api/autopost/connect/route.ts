import { NextResponse } from "next/server"

type PlatformId =
  | "fanvue"
  | "onlyfans"
  | "x"
  | "reddit"

const PLATFORM_URLS: Record<PlatformId, string> = {
  fanvue: "https://www.fanvue.com/",
  onlyfans: "https://onlyfans.com/",
  x: "https://x.com/",
  reddit: "https://www.reddit.com/",
}

const ALL_PLATFORMS = Object.keys(PLATFORM_URLS) as PlatformId[]

function isPlatformId(x: string | null): x is PlatformId {
  if (!x) return false
  return (ALL_PLATFORMS as string[]).includes(x)
}

/**
 * GET /api/autopost/connect?platform=x
 *
 * Launch-safe contract:
 * 200 -> { redirectUrl: string, mode: "external_platform" }
 *
 * This route provides external platform destinations for assisted posting.
 * It does not create native OAuth/API sessions or mark a platform as linked.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const platformParam = url.searchParams.get("platform")

  if (!isPlatformId(platformParam)) {
    return NextResponse.json(
      {
        error: "invalid_platform",
        message: "Query param 'platform' is required and must be a supported platform id.",
        allowed: ALL_PLATFORMS,
      },
      { status: 400 }
    )
  }

  return NextResponse.json(
    {
      redirectUrl: PLATFORM_URLS[platformParam],
      mode: "external_platform",
      message: "Open the creator platform to complete assisted posting.",
    },
    { status: 200 }
  )
}
