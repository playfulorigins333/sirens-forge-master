import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1️⃣ Allow ALL API routes through — no age gate
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 2️⃣ Allow assets, static files, etc.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images") ||
    pathname.includes(".") // file requests
  ) {
    return NextResponse.next();
  }

  // 3️⃣ Allow the age page itself
  if (pathname === "/age") {
    return NextResponse.next();
  }

  // 4️⃣ Apply age gate to everything else
  const hasCookie = req.cookies.get("ageVerified")?.value === "true";

  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/age";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/|_next/|favicon.ico|.*\\.).*)" // exclude API + assets
  ]
};
