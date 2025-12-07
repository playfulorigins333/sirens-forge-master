import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // 🔥 Bypass for Stripe Webhooks
  if (url.pathname.startsWith("/api/webhook")) {
    return NextResponse.next();
  }

  const isVerified = req.cookies.get("ageVerified")?.value === "true";

  if (!isVerified && !url.pathname.startsWith("/age-check")) {
    url.pathname = "/age-check";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|favicon.ico).*)"],
};
