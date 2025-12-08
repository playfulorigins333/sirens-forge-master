import { NextResponse } from "next/server";
import Stripe from "stripe";

export const config = {
  api: {
    bodyParser: false,
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Stripe signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log("🔥 Webhook Event:", event.type);

  switch (event.type) {
    case "checkout.session.completed":
      console.log("Checkout completed:", event.data.object.id);
      break;
  }

  return new Response("OK", { status: 200 });
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" });
}
