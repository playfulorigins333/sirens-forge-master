// lib/supabase.ts
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ✅ Canonical browser client
export const supabase = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey
);

// ✅ Optional named helper if you want it later
export function supabaseBrowser() {
  return supabase;
}
