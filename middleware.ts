import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";

  // ✅ ALWAYS ALLOW LOCALHOST (screenshots, dev, recording)
  if (
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1")
  ) {
    return NextResponse.next();
  }

  // 🔒 PRODUCTION LOCK — force pricing page
  if (hostname === "sirensforge.vip" || hostname === "www.sirensforge.vip") {
    if (!url.pathname.startsWith("/pricing")) {
      return NextResponse.redirect(
        new URL("/pricing", req.url)
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
