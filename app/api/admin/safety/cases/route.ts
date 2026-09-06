import { NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/security/adminAuthorization";
import { listSafetyCases, SAFETY_STATES } from "@/lib/safety/cases";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const authorization = await requireAdminCapability("safety.case.read");
  if (authorization.ok === false) return json({ ok: false, code: authorization.code, ...(authorization.actionPath ? { actionPath: authorization.actionPath } : {}) }, authorization.status);
  const parameters = new URL(req.url).searchParams;
  if ([...parameters.keys()].some((key) => !["state", "before", "before_id", "limit"].includes(key))) return json({ ok: false, code: "SAFETY_PARAMETERS_INVALID" }, 400);
  const state = parameters.get("state");
  const before = parameters.get("before");
  const beforeId = parameters.get("before_id");
  const limit = parameters.get("limit") === null ? 25 : Number(parameters.get("limit"));
  const hasCursor = before !== null || beforeId !== null;
  if (
    (state !== null && !SAFETY_STATES.includes(state as never)) ||
    !Number.isInteger(limit) || limit < 1 || limit > 50 ||
    (hasCursor && (before === null || beforeId === null || !Number.isFinite(Date.parse(before)) || !UUID.test(beforeId)))
  ) return json({ ok: false, code: "SAFETY_PARAMETERS_INVALID" }, 400);
  const cases = await listSafetyCases(authorization.userId, state, before, beforeId, limit);
  return cases ? json({ ok: true, cases }) : json({ ok: false, code: "SAFETY_UNAVAILABLE" }, 503);
}
