import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Supabase OAuth returns access_token + refresh_token in URL fragment
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");

    if (!accessToken || !refreshToken) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/login?error=oauth_missing_tokens`);
    }

    // Store session in Supabase client
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // After successful login → redirect to generator
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/generate`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/login?error=oauth_failed`);
  }
}
