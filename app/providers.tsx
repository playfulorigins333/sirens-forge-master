"use client";

import { ReactNode, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase";

/**
 * Providers
 * ----------
 * Client-side root providers.
 * This hydrates Supabase auth so RLS works in the browser.
 */
export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    const supabase = supabaseBrowser();

    // Force cookie-based session hydration
    supabase.auth.getSession();

    // Keep session reactive (login / refresh / logout)
    const { data: listener } = supabase.auth.onAuthStateChange(() => {});

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
