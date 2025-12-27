import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  const pathname = url.pathname;

  // ✅ ALWAYS ALLOW LOCAL DEV
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return NextResponse.next();
  }

  // ✅ ALWAYS ALLOW API, NEXT, CHECKOUT, & STATIC ASSETS
  // CRITICAL: prevents seat-count JSON from being hijacked
  // CRITICAL: prevents Stripe checkout breakage
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/checkout") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // 🔒 PRODUCTION LOCK — force pricing page only
  if (hostname === "sirensforge.vip" || hostname === "www.sirensforge.vip") {
    if (!pathname.startsWith("/pricing")) {
      const to = new URL("/pricing", req.url);

      // Preserve referral codes (?ref=)
      const ref = url.searchParams.get("ref");
      if (ref) to.searchParams.set("ref", ref);

      return NextResponse.redirect(to);
    }
  }

  return NextResponse.next();
}

export const config = {
  /**
   * ✅ SAFETY MATCHER (LAUNCH LOCK)
   *
   * This matcher ensures middleware ONLY runs on non-API, non-static, non-checkout pages.
   *
   * IMPORTANT:
   * - We explicitly exclude autopost control-plane endpoints.
   * - We explicitly exclude all /api routes.
   * - This prevents pricing redirects from ever affecting cron or platform adapters.
   */
  matcher: [
    "/((?!api/autopost/run|api/autopost/platforms|api|_next|checkout|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
