import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Age verification cookie
  const isVerified = req.cookies.get("ageVerified")?.value === "true";

  // If not verified, force age-check
  if (!isVerified && !url.pathname.startsWith("/age-check")) {
    url.pathname = "/age-check";
    return NextResponse.redirect(url);
  }

  // If verified, allow root "/" to load normally
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|favicon.ico).*)"],
};
