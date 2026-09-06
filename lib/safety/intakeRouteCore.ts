import { NextResponse } from "next/server";
import {
  bounded, optionalBounded, REPORTER_TYPES, SAFETY_CATEGORIES, validEmail,
} from "@/lib/safety/contracts";

const HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };
const ALLOWED_FIELDS = [
  "category", "reporterType", "contactEmail", "affectedReference", "contentUrl",
  "description", "requestedAction", "affectedPersonDeclaration", "goodFaith",
];
type CreateCase = (input: Record<string, unknown>) => Promise<string | null>;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function handleSafetyReport(req: Request, createCase: CreateCase) {
  if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, code: "REPORT_CONTENT_TYPE_INVALID" }, 415);
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 16_384) return json({ ok: false, code: "REPORT_TOO_LARGE" }, 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ ok: false, code: "REPORT_TOO_LARGE" }, 413);

  let value: unknown;
  try { value = JSON.parse(raw); } catch { return json({ ok: false, code: "REPORT_INVALID" }, 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json({ ok: false, code: "REPORT_INVALID" }, 400);
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !ALLOWED_FIELDS.includes(key)) ||
    !SAFETY_CATEGORIES.includes(input.category as never) ||
    !REPORTER_TYPES.includes(input.reporterType as never)
  ) return json({ ok: false, code: "REPORT_INVALID" }, 400);

  const description = bounded(input.description, 20, 4000);
  const contactEmail = validEmail(input.contactEmail);
  const affectedReference = optionalBounded(input.affectedReference, 500);
  const contentUrl = optionalBounded(input.contentUrl, 1000);
  const requestedAction = optionalBounded(input.requestedAction, 1000);
  const declaration = optionalBounded(input.affectedPersonDeclaration, 80);
  if (
    !description || (input.contactEmail != null && !contactEmail) ||
    (input.affectedReference != null && !affectedReference) ||
    (input.contentUrl != null && (!contentUrl || !/^https?:\/\//i.test(contentUrl))) ||
    (input.requestedAction != null && !requestedAction) ||
    (input.affectedPersonDeclaration != null && !declaration) || input.goodFaith !== true
  ) return json({ ok: false, code: "REPORT_INVALID" }, 400);
  if (
    ["NCII", "UNAUTHORIZED_INTIMATE_AI"].includes(input.category as string) &&
    (!declaration || !["AFFECTED_PERSON", "AUTHORIZED_REPRESENTATIVE"].includes(declaration))
  ) return json({ ok: false, code: "REPORT_INVALID" }, 400);

  try {
    const caseReference = await createCase({
      ...input, description, contactEmail, affectedReference, contentUrl, requestedAction,
      affectedPersonDeclaration: declaration,
    });
    return caseReference
      ? json({ ok: true, caseReference }, 201)
      : json({ ok: false, code: "REPORT_UNAVAILABLE" }, 503);
  } catch {
    return json({ ok: false, code: "REPORT_UNAVAILABLE" }, 503);
  }
}
