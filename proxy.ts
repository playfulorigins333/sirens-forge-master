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
  "/report-intimate-content",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/dmca",
  "/complaints",
  "/community-guidelines",
  "/underage-policy",
  "/age",
  "/blocked-content",
  "/2257-exemption",
  "/affiliate-terms",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const PUBLIC_PREFIXES = ["/_next", "/api", "/auth"];
export const AGE_ATTESTATION_COOKIE = "sf_age_attested";
const AGE_EXEMPT_PATHS = new Set([
  "/age", "/terms", "/privacy", "/acceptable-use", "/community-guidelines",
  "/underage-policy", "/blocked-content", "/content-removal",
  "/report-intimate-content", "/complaints", "/dmca", "/2257-exemption",
  "/contact", "/affiliate-terms", "/robots.txt", "/sitemap.xml", "/favicon.ico",
]);
const AGE_EXEMPT_API_PATHS = new Set([
  "/api/age-attestation",
  "/api/safety/reports",
  "/api/health",
  "/api/ping",
  "/api/status",
  "/api/webhook",
  "/api/webhook/payment-v2",
]);
const AGE_EXEMPT_API_PREFIXES = ["/api/internal/"];
const AGE_EXEMPT_CALLBACK_PATHS = new Set([
  "/api/autopost/connect/fanvue/callback",
  "/api/autopost/connect/x/callback",
]);
const LEGACY_AUTOPOST_ADMIN_ROOT = "/api/admin/autopost";
export const LEGACY_AUTOPOST_ADMIN_ENABLE_ENV =
  "SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED" as const;

// Legacy Autopost admin diagnostics/proof routes are not part of the Phase 1
// launch path. CPQ is the authoritative Fanvue publishing state machine. Keep
// the entire legacy admin surface fail-closed unless an operator deliberately
// enables it for a controlled diagnostic window.
export function legacyAutopostAdminEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[LEGACY_AUTOPOST_ADMIN_ENABLE_ENV] === "true";
}

export function shouldBlockLegacyAutopostAdmin(
  pathname: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const inLegacyAdminSurface =
    pathname === LEGACY_AUTOPOST_ADMIN_ROOT ||
    pathname.startsWith(`${LEGACY_AUTOPOST_ADMIN_ROOT}/`);
  return inLegacyAdminSurface && !legacyAutopostAdminEnabled(env);
}

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

export function isAgeExemptPath(pathname: string): boolean {
  return AGE_EXEMPT_PATHS.has(pathname) || pathname.startsWith("/_next") ||
    AGE_EXEMPT_API_PATHS.has(pathname) || AGE_EXEMPT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname.startsWith("/auth") || AGE_EXEMPT_CALLBACK_PATHS.has(pathname) ||
    pathname.startsWith(BOTID_INTERNAL_PREFIX) || pathname.startsWith(VERCEL_RATE_LIMIT_API_PREFIX);
}

export function safeAgeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://age.invalid");
    decodeURI(parsed.pathname);
    return parsed.origin === "https://age.invalid" && !isAgeExemptPath(parsed.pathname)
      ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch { return "/"; }
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (shouldBlockLegacyAutopostAdmin(pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  if (!isAgeExemptPath(pathname) && req.cookies.get(AGE_ATTESTATION_COOKIE)?.value !== "1") {
    const ageUrl = new URL("/age", req.url);
    ageUrl.searchParams.set("next", safeAgeReturnPath(`${pathname}${req.nextUrl.search}`));
    return NextResponse.redirect(ageUrl);
  }

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
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
