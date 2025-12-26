import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const hostname = req.headers.get("host") || "";

  // ✅ NEVER touch Next.js internals or assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map")
  ) {
    return NextResponse.next();
  }

  // ✅ ALWAYS allow localhost
  if (
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1")
  ) {
    return NextResponse.next();
  }

  // 🔒 PRODUCTION LOCK — force pricing page ONLY for pages
  if (hostname === "sirensforge.vip" || hostname === "www.sirensforge.vip") {
    if (!pathname.startsWith("/pricing")) {
      return NextResponse.redirect(new URL("/pricing", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
