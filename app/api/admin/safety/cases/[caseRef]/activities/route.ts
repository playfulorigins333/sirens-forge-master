import { NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/security/adminAuthorization";
import { listSafetyActivities } from "@/lib/safety/cases";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const CASE_REFERENCE = /^SF-SAF-[0-9]{8}-[0-9]{8}$/;

export async function GET(req: Request, context: { params: Promise<{ caseRef: string }> }) {
  const authorization = await requireAdminCapability("safety.case.read");
  if (authorization.ok === false) return json({ ok: false, code: authorization.code, ...(authorization.actionPath ? { actionPath: authorization.actionPath } : {}) }, authorization.status);
  const { caseRef } = await context.params;
  if (!CASE_REFERENCE.test(caseRef)) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  const parameters = new URL(req.url).searchParams;
  if ([...parameters.keys()].some((key) => !["before_sequence", "limit"].includes(key))) return json({ ok: false, code: "SAFETY_PARAMETERS_INVALID" }, 400);
  const before = parameters.get("before_sequence") === null ? null : Number(parameters.get("before_sequence"));
  const limit = parameters.get("limit") === null ? 50 : Number(parameters.get("limit"));
  if ((before !== null && (!Number.isSafeInteger(before) || before < 1)) || !Number.isInteger(limit) || limit < 1 || limit > 100) return json({ ok: false, code: "SAFETY_PARAMETERS_INVALID" }, 400);
  const result = await listSafetyActivities(authorization.userId, caseRef, before, limit);
  if (result.kind === "not_found") return json({ ok: false, code: "SAFETY_NOT_FOUND" }, 404);
  if (result.kind === "unavailable") return json({ ok: false, code: "SAFETY_UNAVAILABLE" }, 503);
  return json({ ok: true, activities: result.value });
}
