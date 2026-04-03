// lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type RequireUserIdOptions = {
  /**
   * Optional Request so we can read headers in dev if you want.
   * You can call requireUserId(request) from route handlers.
   */
  request?: Request;
};

/**
 * DEV BYPASS (LOCAL ONLY)
 * ------------------------------------------------------------
 * If you set DEV_BYPASS_USER_ID in .env.local, requireUserId()
 * will return that user id without needing a browser login session.
 *
 * This is ONLY intended for local wiring while the pricing gate blocks login.
 * Do NOT set DEV_BYPASS_USER_ID in production env vars.
 */
function devBypassUserId(request?: Request): string | null {
  if (process.env.NODE_ENV === "production") return null;

  const envId = process.env.DEV_BYPASS_USER_ID;
  if (envId && envId.trim().length > 0) return envId.trim();

  const headerId = request?.headers.get("x-dev-user-id");
  if (headerId && headerId.trim().length > 0) return headerId.trim();

  return null;
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Server-side Supabase client (App Router / Route Handlers / Server Components)
 *
 * IMPORTANT:
 * - In Route Handlers, cookies can be set/removed normally.
 * - In Server Components/layouts, cookies are read-only.
 *
 * So set/remove must fail silently when called in read-only contexts.
 */
export async function supabaseServer() {
  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Read-only context (e.g. Server Components/layouts). Ignore safely.
        }
      },
      remove(name: string, options: any) {
        try {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        } catch {
          // Read-only context (e.g. Server Components/layouts). Ignore safely.
        }
      },
    },
  });
}

/**
 * Returns the authenticated user's id.
 * In local dev, you can bypass auth by setting DEV_BYPASS_USER_ID.
 */
export async function requireUserId(
  options: RequireUserIdOptions = {}
): Promise<string> {
  const bypass = devBypassUserId(options.request);
  if (bypass) return bypass;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user?.id) {
    throw new Error("Unauthorized");
  }

  return data.user.id;
}