import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs"; // required for raw body parsing

export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2023-10-16",
  });

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
