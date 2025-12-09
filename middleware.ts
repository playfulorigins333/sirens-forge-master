// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow API routes
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Allow static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) return NextResponse.next();

  // Allow login + OAuth callback
  if (pathname === "/login" || pathname.startsWith("/auth")) {
    return NextResponse.next();
  }

  // Allow age gate
  if (pathname === "/age-check" || pathname === "/age") {
    return NextResponse.next();
  }

  // Age cookie check
  const isVerified = req.cookies.get("ageVerified")?.value === "true";
  if (!isVerified) {
    const url = req.nextUrl.clone();
    url.pathname = "/age";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/webhook|_next/|favicon.ico|.*\\.).*)",
  ],
};
