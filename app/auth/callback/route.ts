import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { oauthCallbackDestination } from "@/lib/auth/checkoutContinuation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const failure = () => NextResponse.redirect(new URL(oauthCallbackDestination(null, false), origin));
  try {
    const code = url.searchParams.get("code");
    if (!code) return failure();
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure();
    return NextResponse.redirect(new URL(oauthCallbackDestination(url.searchParams.get("checkout_intent"), true), origin));
  } catch {
    return failure();
  }
}
