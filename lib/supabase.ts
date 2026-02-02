// lib/supabase.ts
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * IMPORTANT:
 * Do NOT create a singleton Supabase browser client at module scope.
 * In Next.js App Router this causes auth.uid() to be NULL due to
 * session hydration timing.
 *
 * Always create the browser client at call-time.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
  );
}
