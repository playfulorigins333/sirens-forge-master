import { NextResponse } from "next/server";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { AccountDataRightsError, reactivateVoluntaryAccountDeletion } from "@/lib/account-data-rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const auth = await ensureAuthenticatedProfile();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await reactivateVoluntaryAccountDeletion(auth.user.id, auth.profile.id);
    return NextResponse.json({ ok: true, deletion: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountDataRightsError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "ACCOUNT_DATA_RIGHTS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
