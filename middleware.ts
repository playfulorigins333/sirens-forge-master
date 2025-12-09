import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1️⃣ Allow ALL API routes through — including webhook
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 2️⃣ Allow static assets, images, Next.js system files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // 3️⃣ Allow the age-check page itself
  if (pathname === "/age-check") {
    return NextResponse.next();
  }

  // 4️⃣ Normal age gate logic
  const hasCookie = req.cookies.get("ageVerified")?.value === "true";

  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/age-check";   // 🔥 FIXED: always redirect to /age-check
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply middleware only to non-API, non-static pages
    "/((?!api/webhook|api/|_next/|favicon.ico|.*\\.).*)"
  ]
};
