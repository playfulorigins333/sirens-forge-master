import "./globals.css";
import { ReactNode, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export const metadata = {
  title: "Sirens Forge",
};

/**
 * SupabaseAuthProvider
 * --------------------
 * This hydrates the Supabase browser auth session exactly once.
 * Required for client-side RLS queries to receive auth.uid().
 */
function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const supabase = supabaseBrowser();

    // Force session hydration on first client render
    supabase.auth.getSession();

    // Subscribe to auth changes (login, logout, refresh)
    const { data: listener } = supabase.auth.onAuthStateChange(
      () => {}
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
      </body>
    </html>
  );
}
