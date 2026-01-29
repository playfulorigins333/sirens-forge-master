// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  const pathname = url.pathname;

  // ✅ ALWAYS ALLOW LOCAL DEV
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return NextResponse.next();
  }

  // ✅ ALWAYS ALLOW API + INTERNAL + STATIC
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/login") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // ✅ Create response we can attach Set-Cookie headers to
  const res = NextResponse.next();

  // ✅ CRITICAL: This is what keeps sb-* cookies alive in prod
  const supabase = createServerClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  // 🔥 This refreshes/creates cookies if a session exists
  await supabase.auth.getUser();

  // 🔒 Detect session cookie after sync
  const hasSession = Array.from(res.cookies.getAll()).some(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  ) || req.cookies.getAll().some(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );

  // 🔒 PRODUCTION DOMAIN RULES
  if (hostname === "sirensforge.vip" || hostname === "www.sirensforge.vip") {
    // 🚫 NOT LOGGED IN
    if (!hasSession) {
      // ✅ Allow generate + lora routes (your choice)
      if (pathname === "/generate" || pathname.startsWith("/lora")) {
        return res;
      }

      // 🔒 Everything else → pricing
      if (!pathname.startsWith("/pricing")) {
        const to = new URL("/pricing", req.url);

        const ref = url.searchParams.get("ref");
        if (ref) to.searchParams.set("ref", ref);

        return NextResponse.redirect(to);
      }
    }

    return res;
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!api|_next|checkout|auth|login|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
