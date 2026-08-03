import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  buildCallbackFailurePath,
  canonicalizePaymentContinuation,
  establishCallbackSession,
  parseCallbackCredentials,
  paymentFirstAuthContinuationEnabled,
  selectCallbackRedirect,
  trustedApplicationOrigin,
  type AuthErrorCode,
} from "@/lib/payment-v2/authContinuation";

export async function GET(request: Request) {
  const origin = trustedApplicationOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NODE_ENV === "production",
  );
  if (!origin) return NextResponse.json({ error: "Authentication callback is unavailable." }, { status: 500 });

  const params = new URL(request.url).searchParams;
  const enabled = paymentFirstAuthContinuationEnabled({
    PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: process.env.PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED,
    PAYMENT_FIRST_SUCCESS_V2_ENABLED: process.env.PAYMENT_FIRST_SUCCESS_V2_ENABLED,
  });
  const nextValues = params.getAll("next");
  const continuation = enabled && nextValues.length === 1
    ? canonicalizePaymentContinuation(nextValues[0]) : null;
  const redirect = (path: string) => NextResponse.redirect(new URL(path, origin));
  const fail = (code: AuthErrorCode) => redirect(buildCallbackFailurePath(code, continuation));

  const providerFailure = ["error", "error_code", "error_description"].some((key) => params.has(key));
  if (providerFailure) return fail("oauth_failed");
  const credentials = parseCallbackCredentials(params);
  if (!credentials) return fail("oauth_missing_credentials");

  try {
    const supabase = await supabaseServer();
    const failure = await establishCallbackSession(supabase.auth, credentials);
    return failure ? fail(failure) : redirect(selectCallbackRedirect(continuation));
  } catch {
    return fail("oauth_failed");
  }
}
