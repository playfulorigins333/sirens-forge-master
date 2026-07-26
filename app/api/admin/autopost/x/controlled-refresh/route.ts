import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  createXControlledRefreshAccountLoader,
  createXControlledRefreshWriter,
  handleXControlledRefreshRequest,
  xControlledRefreshMethodNotAllowedResult,
} from "@/lib/autopost/xControlledRefresh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const response = await handleXControlledRefreshRequest({
    request,
    getAuthenticatedUserId: () => requireUserId({ request }),
    createPrivilegedAccess: () => {
      const client = getSupabaseAdmin()
      return {
        load: createXControlledRefreshAccountLoader(client),
        writer: createXControlledRefreshWriter(client),
      }
    },
  })
  return NextResponse.json(response.body, { status: response.status, headers: SECURITY_HEADERS })
}

export function GET() {
  return NextResponse.json(xControlledRefreshMethodNotAllowedResult(), {
    status: 405,
    headers: SECURITY_HEADERS,
  })
}
