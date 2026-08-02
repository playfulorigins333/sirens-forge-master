import { NextResponse } from "next/server";
import { paymentFirstClaimStatus, PAYMENT_V2_CLAIM_COOKIE } from "@/lib/payment-v2/claimService";
import { claimDatabase } from "../claim/routeDatabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.PAYMENT_FIRST_CLAIM_V2_ENABLED !== "true") return NextResponse.json({ error: "Payment-first claiming is not active", code: "PAYMENT_FIRST_CLAIM_V2_DISABLED" }, { status: 503 });
  const result = await paymentFirstClaimStatus({ enabled: process.env.PAYMENT_FIRST_CLAIM_V2_ENABLED, production: process.env.NODE_ENV === "production",
    readSessionId: () => { const values = new URL(request.url).searchParams.getAll("session_id"); return values.length === 1 && [...new URL(request.url).searchParams.keys()].every(k => k === "session_id") ? values[0] : null; },
    readCookie: () => request.headers.get("cookie")?.split(";").map(v => v.trim()).filter(v => v.startsWith(`${PAYMENT_V2_CLAIM_COOKIE}=`)).reduce<string | undefined>((one, v, _i, all) => all.length === 1 ? v.slice(PAYMENT_V2_CLAIM_COOKIE.length + 1) : undefined, undefined),
    createDatabase: claimDatabase });
  return NextResponse.json(result.body, { status: result.status });
}
