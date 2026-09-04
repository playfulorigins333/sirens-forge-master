// lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type RequireUserIdOptions = {
  request?: Request;
};

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

export async function supabaseServer() {
  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }); } catch {} },
      remove(name: string, options: any) { try { cookieStore.set({ name, value: "", ...options, maxAge: 0 }); } catch {} },
    },
  });
}

/**
 * Legacy creator-product identity boundary. Data-rights, Billing, Account, Security,
 * and reactivation intentionally do not use this helper. During a voluntary
 * deletion recovery window this fails closed so old Autopost/admin-style routes
 * cannot bypass the central product freeze simply because an Auth JWT is valid.
 */
export async function requireUserId(options: RequireUserIdOptions = {}): Promise<string> {
  const bypass = devBypassUserId(options.request);
  if (bypass) return bypass;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Unauthorized");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_lifecycle_state")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profileError || !profile) throw new Error("Unauthorized");
  if ((profile.account_lifecycle_state ?? "active") !== "active") throw new Error("AccountFrozen");

  return data.user.id;
}
