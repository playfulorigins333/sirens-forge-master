import LoginClient from "./LoginClient";
import {
  AUTH_ERROR_MESSAGES,
  buildAuthCallbackUrl,
  canonicalizePaymentContinuation,
  paymentFirstAuthContinuationEnabled,
  sanitizeAuthError,
  sanitizeLoginMode,
  singleQueryValue,
  trustedApplicationOrigin,
} from "@/lib/payment-v2/authContinuation";

export const dynamic = "force-dynamic";

type LoginSearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({ searchParams }: { searchParams: Promise<LoginSearchParams> }) {
  const params = await searchParams;
  const enabled = paymentFirstAuthContinuationEnabled({
    PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: process.env.PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED,
    PAYMENT_FIRST_SUCCESS_V2_ENABLED: process.env.PAYMENT_FIRST_SUCCESS_V2_ENABLED,
  });
  const recognized = new Set(["next", "mode", "error"]);
  const unambiguous = Object.entries(params).every(([key, value]) =>
    recognized.has(key) && typeof value === "string"
  );
  const next = singleQueryValue(params.next);
  const continuation = enabled && unambiguous ? canonicalizePaymentContinuation(next) : null;
  const errorCode = sanitizeAuthError(singleQueryValue(params.error));
  const origin = trustedApplicationOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NODE_ENV === "production",
  );

  return <LoginClient
    initialMode={sanitizeLoginMode(singleQueryValue(params.mode))}
    continuation={continuation}
    authError={errorCode ? AUTH_ERROR_MESSAGES[errorCode] : null}
    callbackUrl={origin ? buildAuthCallbackUrl(origin, continuation) : null}
  />;
}
