import { NextResponse } from "next/server"

type PlatformId =
  | "fanvue"
  | "onlyfans"
  | "fansly"
  | "loyalfans"
  | "jff"
  | "x"
  | "reddit"

const ALL_PLATFORMS: PlatformId[] = [
  "fanvue",
  "onlyfans",
  "fansly",
  "loyalfans",
  "jff",
  "x",
  "reddit",
]

// Platforms that require OAuth before we can mark “connected”
const OAUTH_REQUIRED: PlatformId[] = ["onlyfans", "fansly", "loyalfans", "jff", "x", "reddit"]

// Fanvue is internal primary and connected by default (no OAuth redirect needed)
const FANVUE_DEFAULT_REDIRECT = "/autopost"

function isPlatformId(x: string | null): x is PlatformId {
  if (!x) return false
  return (ALL_PLATFORMS as string[]).includes(x)
}

/**
 * GET /api/autopost/connect?platform=x
 *
 * Contract (LOCKED):
 * 200 -> { redirectUrl: string }
 *
 * Rules:
 * - Frontend must never fake connected state.
 * - OAuth handled server-side only.
 * - Fanvue is connected by default.
 *
 * This route is launch-safe:
 * - Fanvue returns a valid redirectUrl immediately.
 * - Other platforms return non-200 until OAuth start endpoints exist,
 *   ensuring the UI cannot “pretend” a platform is connected.
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

  const platform: PlatformId = platformParam

  // Fanvue: internal primary, connected by default, no OAuth redirect needed.
  if (platform === "fanvue") {
    return NextResponse.json({ redirectUrl: FANVUE_DEFAULT_REDIRECT }, { status: 200 })
  }

  // Everything else: require OAuth start route (server-side) BEFORE we can claim connected.
  // We intentionally return non-200 until those routes exist.
  if (OAUTH_REQUIRED.includes(platform)) {
    return NextResponse.json(
      {
        error: "oauth_not_implemented",
        message:
          "OAuth connect flow for this platform is not implemented yet. UI must treat as NOT connected.",
        platform,
      },
      { status: 501 }
    )
  }

  // Defensive fallback (should never hit because ALL_PLATFORMS is exhaustive)
  return NextResponse.json(
    { error: "unsupported_platform", message: "Unsupported platform.", platform },
    { status: 400 }
  )
}
