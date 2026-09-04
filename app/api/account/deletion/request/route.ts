import { NextResponse } from "next/server";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { AccountDataRightsError, requestVoluntaryAccountDeletion } from "@/lib/account-data-rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

type RequestBody = {
  export_choice: "export_before_deletion" | "skip_export";
  export_job_id: string | null;
  confirmation_phrase: string;
};

export async function POST(request: Request) {
  const auth = await ensureAuthenticatedProfile();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  const record = body as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "confirmation_phrase,export_choice,export_job_id") return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  if (!(["export_before_deletion", "skip_export"] as unknown[]).includes(record.export_choice) || (record.export_job_id !== null && typeof record.export_job_id !== "string") || typeof record.confirmation_phrase !== "string") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  const typed = record as unknown as RequestBody;
  try {
    const result = await requestVoluntaryAccountDeletion({
      authUserId: auth.user.id,
      profileId: auth.profile.id,
      exportChoice: typed.export_choice,
      exportJobId: typed.export_job_id,
      confirmationPhrase: typed.confirmation_phrase,
    });
    return NextResponse.json({ ok: true, deletion: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountDataRightsError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "ACCOUNT_DATA_RIGHTS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
