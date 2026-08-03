import { notFound } from "next/navigation";
import PaymentFirstSuccessClient from "./PaymentFirstSuccessClient";
import { paymentFirstSuccessEnabled, validateSuccessSearchParams } from "@/lib/payment-v2/successFlow";

export const dynamic = "force-dynamic";

export default async function BillingSuccessPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!paymentFirstSuccessEnabled(process.env.PAYMENT_FIRST_SUCCESS_V2_ENABLED)) notFound();
  const sessionId = validateSuccessSearchParams(await searchParams);
  if (!sessionId) notFound();
  return <PaymentFirstSuccessClient sessionId={sessionId} />;
}
