import { NextResponse } from "next/server";
import { AGE_ATTESTATION_COOKIE, safeAgeReturnPath } from "@/proxy";

const NO_STORE = { "Cache-Control": "no-store" };

function invalid(status: 400 | 413 | 415 | 403) {
  return NextResponse.json(
    { ok: false, code: "AGE_ATTESTATION_INVALID" },
    { status, headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  const type = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return invalid(415);

  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return invalid(403);
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(req.url).origin) return invalid(403);
    } catch {
      return invalid(403);
    }
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 2048) return invalid(413);
  const form = new URLSearchParams(raw);
  if (
    [...form.keys()].some((key) => !["attest", "next"].includes(key)) ||
    form.getAll("attest").length !== 1 ||
    form.get("attest") !== "18plus" ||
    form.getAll("next").length > 1
  ) return invalid(400);

  const response = NextResponse.redirect(
    new URL(safeAgeReturnPath(form.get("next")), req.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(AGE_ATTESTATION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
