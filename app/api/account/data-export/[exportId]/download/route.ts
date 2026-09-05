import { NextResponse } from "next/server";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { AccountDataRightsError, signCreatorDataExportDownload } from "@/lib/account-data-rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ exportId: string }> }) {
  const auth = await ensureAuthenticatedProfile();
  if (auth.ok === false) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { exportId } = await context.params;
  try {
    const result = await signCreatorDataExportDownload(exportId, auth.user.id);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountDataRightsError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "EXPORT_DOWNLOAD_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
