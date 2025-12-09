import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export async function POST(req: Request) {
  try {
    const { userId, tierId, tier } = await req.json();

    if (!userId || !tierId || !tier?.priceId) {
      return NextResponse.json(
        { error: "Missing subscription checkout fields" },
        { status: 400 }
      );
    }

    // Create or fetch customer
    const customerId = await getOrCreateStripeCustomer(userId);

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: tier.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
      metadata: {
        user_id: userId,
        tier_id: tierId,
        tier_name: tier?.name,
        type: "subscription",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("❌ Subscription Checkout Error:", err);
    return NextResponse.json(
      {
        error: err?.message ?? "Failed to create subscription checkout",
      },
      { status: 500 }
    );
  }
}
