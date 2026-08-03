import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { paymentFirstSuccessEnabled } from "@/lib/payment-v2/successFlow";

export const dynamic = "force-dynamic";

export default function BillingCancelPage() {
  if (!paymentFirstSuccessEnabled(process.env.PAYMENT_FIRST_SUCCESS_V2_ENABLED)) notFound();
  return <main className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-purple-950 px-4 py-16 text-white">
    <Card className="mx-auto max-w-xl border-gray-700 bg-gray-900/80">
      <CardHeader><CardTitle className="text-2xl">Checkout not completed</CardTitle><CardDescription>You left Checkout before it was completed. You can return to pricing whenever you’re ready.</CardDescription></CardHeader>
      <CardContent className="flex gap-3"><Button asChild><Link href="/pricing">Back to pricing</Link></Button><Button asChild variant="outline"><Link href="/">Go to homepage</Link></Button></CardContent>
    </Card>
  </main>;
}
