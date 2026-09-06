import { NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/security/adminAuthorization";
import { bounded, getSafetyCase, REASON_CODES, SAFETY_STATES, transitionSafetyCase } from "@/lib/safety/cases";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const CASE_REFERENCE = /^SF-SAF-[0-9]{8}-[0-9]{8}$/;

export async function GET(_: Request, context: { params: Promise<{ caseRef: string }> }) {
  const authorization = await requireAdminCapability("safety.case.read");
  if (authorization.ok === false) return json({ ok: false, code: authorization.code, ...(authorization.actionPath ? { actionPath: authorization.actionPath } : {}) }, authorization.status);
  const { caseRef } = await context.params;
  if (!CASE_REFERENCE.test(caseRef)) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  const result = await getSafetyCase(authorization.userId, caseRef);
  if (result.kind === "not_found") return json({ ok: false, code: "SAFETY_NOT_FOUND" }, 404);
  if (result.kind === "unavailable") return json({ ok: false, code: "SAFETY_UNAVAILABLE" }, 503);
  return json({ ok: true, case: result.value });
}

export async function PATCH(req: Request, context: { params: Promise<{ caseRef: string }> }) {
  const authorization = await requireAdminCapability("safety.case.manage");
  if (authorization.ok === false) return json({ ok: false, code: authorization.code, ...(authorization.actionPath ? { actionPath: authorization.actionPath } : {}) }, authorization.status);
  if (req.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 415);
  const { caseRef } = await context.params;
  if (!CASE_REFERENCE.test(caseRef)) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  let value: unknown;
  try { value = await req.json(); } catch { return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["state", "reasonCode", "reason", "outcomeSummary"].includes(key))) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  const state = SAFETY_STATES.includes(input.state as never) ? input.state as string : null;
  const reasonCode = REASON_CODES.includes(input.reasonCode as never) ? input.reasonCode as string : null;
  const reason = bounded(input.reason, 3, 1000);
  const outcome = input.outcomeSummary == null ? null : bounded(input.outcomeSummary, 3, 1000);
  if (!state || !reasonCode || !reason || (state === "CLOSED" ? !outcome : input.outcomeSummary != null)) return json({ ok: false, code: "SAFETY_REQUEST_INVALID" }, 400);
  const result = await transitionSafetyCase(authorization.userId, caseRef, state, reasonCode, reason, outcome);
  if (result.kind === "not_found") return json({ ok: false, code: "SAFETY_NOT_FOUND" }, 404);
  if (result.kind === "invalid_transition") return json({ ok: false, code: "SAFETY_UPDATE_REJECTED" }, 409);
  if (result.kind === "unavailable") return json({ ok: false, code: "SAFETY_UNAVAILABLE" }, 503);
  return json({ ok: true });
}
