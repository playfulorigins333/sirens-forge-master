import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { checkoutPricingUrl, parseCheckoutContinuation } from "@/lib/auth/checkoutContinuation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const failure = () => NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  try {
    const code = url.searchParams.get("code");
    if (!code) return failure();
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure();
    const intent = parseCheckoutContinuation(url.searchParams.get("checkout_intent"));
    return NextResponse.redirect(new URL(intent ? checkoutPricingUrl(intent) : "/generate", origin));
  } catch {
    return failure();
  }
}
