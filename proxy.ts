import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/pricing",
  "/billing/success",
  "/billing/cancel",
  "/faq",
  "/contact",
  "/content-removal",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const PUBLIC_PREFIXES = ["/_next", "/api", "/auth"];

// Next.js Proxy runs before next.config rewrites, so the auth proxy must not
// redirect BotID's internal challenge/proxy namespace.
const BOTID_INTERNAL_PREFIX =
  "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/";
const VERCEL_RATE_LIMIT_API_PREFIX =
  "/.well-known/vercel/rate-limit-api/";

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith(BOTID_INTERNAL_PREFIX) ||
    pathname.startsWith(VERCEL_RATE_LIMIT_API_PREFIX) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const landingUrl = new URL("/", req.url);
    landingUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(landingUrl);
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
