import { NextResponse } from "next/server";
import Stripe from "stripe";
import { addTokens } from "@/lib/tokens/adjust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Invalid Stripe signature:", err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  console.log("🔥 Stripe webhook:", event.type);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};

        // Only handle token pack purchases here
        if (metadata.type === "token_pack") {
          const userId = metadata.user_id;
          const tokens = Number(metadata.tokens || 0);

          if (!userId || !tokens) {
            console.error(
              "❌ Missing userId or tokens in token_pack metadata",
              metadata
            );
            break;
          }

          console.log(`💰 Adding ${tokens} tokens to user ${userId}`);

          // addTokens(userId, amount, reason)
          await addTokens(userId, tokens, "Token Pack Purchase");
        }

        break;
      }

      default:
        console.log("ℹ️ Ignored webhook event:", event.type);
        break;
    }
  } catch (err: any) {
    console.error("🔥 Webhook processing error:", err);
    return NextResponse.json(
      { error: err.message ?? "Webhook failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" });
}
