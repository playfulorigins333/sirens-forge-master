// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow Next internals, static files, and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Allow age gate itself
  if (pathname === "/age") {
    return NextResponse.next();
  }

  // 🔐 Check age verification cookie (CANONICAL NAME)
  const ageVerified =
    req.cookies.get("sf_age_verified")?.value === "true";

  if (!ageVerified) {
    const url = req.nextUrl.clone();
    url.pathname = "/age";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api).*)"],
};
