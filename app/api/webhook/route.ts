import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs"; // Required for raw body parsing

export async function POST(req: Request) {
  // ❌ Removed apiVersion to prevent Vercel TypeScript error
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Signature verification failed:", err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log("✅ Stripe webhook received:", event.type);

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" });
}
