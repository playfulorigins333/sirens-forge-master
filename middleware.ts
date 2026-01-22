import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  const pathname = url.pathname;

  // ✅ ALWAYS ALLOW LOCAL DEV
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return NextResponse.next();
  }

  // ✅ ALWAYS ALLOW API, NEXT, CHECKOUT, STATIC, AUTH, LOGIN
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/auth") ||
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // 🔐 Detect Supabase session (v2-compatible)
  const hasSession = req.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") &&
        cookie.name.endsWith("-auth-token")
    );

  // 🔒 PRODUCTION DOMAIN RULES
  if (hostname === "sirensforge.vip" || hostname === "www.sirensforge.vip") {
    // 🚫 NOT LOGGED IN
    if (!hasSession) {
      // ✅ Allow post-login landing routes (auth race)
      if (
        pathname === "/generate" ||
        pathname.startsWith("/lora/train")
      ) {
        return NextResponse.next();
      }

      // 🔒 Everything else → pricing
      if (!pathname.startsWith("/pricing")) {
        const to = new URL("/pricing", req.url);

        // Preserve referral codes (?ref=)
        const ref = url.searchParams.get("ref");
        if (ref) to.searchParams.set("ref", ref);

        return NextResponse.redirect(to);
      }
    }

    // ✅ LOGGED IN USERS → allow everything
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/autopost/run|api/autopost/platforms|api|_next|checkout|auth|login|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
