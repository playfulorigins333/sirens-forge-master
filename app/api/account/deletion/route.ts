import { NextResponse } from "next/server";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { AccountDataRightsError, getVoluntaryDeletionState } from "@/lib/account-data-rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const auth = await ensureAuthenticatedProfile();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    const deletion = await getVoluntaryDeletionState(auth.user.id, auth.profile.id);
    return NextResponse.json({ deletion }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountDataRightsError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "ACCOUNT_DATA_RIGHTS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
