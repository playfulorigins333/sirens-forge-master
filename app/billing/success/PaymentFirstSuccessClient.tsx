"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { browserSuccessDependencies, buildPaymentSuccessLinks, PaymentFirstSuccessFlow, type SuccessState } from "@/lib/payment-v2/successFlow";

export default function PaymentFirstSuccessClient({ sessionId }: { sessionId: string }) {
  const flow = useMemo(() => new PaymentFirstSuccessFlow(sessionId, browserSuccessDependencies()), [sessionId]);
  const links = useMemo(() => buildPaymentSuccessLinks(sessionId), [sessionId]);
  const [state, setState] = useState<SuccessState>({ view: "loading", busy: false });
  useEffect(() => { const unsubscribe = flow.subscribe(setState); flow.start(); return unsubscribe; }, [flow]);

  const content: Record<SuccessState["view"], [string, string]> = {
    loading: ["Verifying your purchase", "We’re securely checking the status of your Checkout."],
    processing: ["Payment confirmation is processing", "Payment confirmation is still being finalized. This page will check again shortly."],
    sign_in: ["Payment confirmed", "Create an account or sign in to attach your paid access."],
    claiming: ["Attaching your access", "Your payment is confirmed. We’re securely attaching access to your account."],
    profile_setup: ["Finishing account setup", "Your account setup is being finalized before access can be attached."],
    claimed: ["Your access is ready", "Paid access has been attached to your account."],
    unavailable: ["Checkout unavailable", "This Checkout can no longer be completed through this link."],
    not_found: ["Purchase link not verified", "We could not verify this purchase link."],
    error: ["Temporarily unable to verify", "We couldn’t complete verification right now. Please try again."],
    timed_out: ["Still waiting", "This is taking longer than expected. You can safely try again."],
  };
  const [heading, message] = content[state.view];

  return <main className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-purple-950 px-4 py-16 text-white">
    <Card className="mx-auto max-w-xl border-gray-700 bg-gray-900/80">
      <CardHeader><CardTitle className="text-2xl">{heading}</CardTitle><CardDescription aria-live="polite">{message}</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {state.view === "sign_in" && <><Button asChild><Link href={links.signIn}>Sign in</Link></Button><Button asChild variant="outline"><Link href={links.signUp}>Create account</Link></Button></>}
        {state.view === "claimed" && <Button asChild><Link href="/dashboard">Continue to dashboard</Link></Button>}
        {["unavailable", "not_found"].includes(state.view) && <Button asChild><Link href="/pricing">Back to pricing</Link></Button>}
        {["error", "timed_out"].includes(state.view) && <Button type="button" disabled={state.busy} onClick={() => flow.retry()}>Retry</Button>}
        {["loading", "processing", "claiming", "profile_setup"].includes(state.view) && <span role="status" className="text-sm text-gray-300">Please wait…</span>}
      </CardContent>
    </Card>
  </main>;
}
