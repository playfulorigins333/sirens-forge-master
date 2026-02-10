import { NextResponse } from "next/server";
import Stripe from "stripe";
import { TOKEN_PACKS } from "@/lib/tokens/packs";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export async function POST(req: Request) {
  try {
    const { userId, packId } = await req.json();

    if (!userId || !packId) {
      return NextResponse.json(
        { error: "Missing userId or packId" },
        { status: 400 }
      );
    }

    const pack = TOKEN_PACKS.find((p) => p.id === packId);

    if (!pack) {
      return NextResponse.json(
        { error: "Invalid token pack ID" },
        { status: 404 }
      );
    }

    // ensure Stripe customer exists
    const customerId = await getOrCreateStripeCustomer(userId);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price: pack.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/tokens/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/tokens/cancel`,
      metadata: {
        type: "token_pack",
        user_id: userId,
        pack_id: pack.id,
        tokens: pack.tokens,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("❌ Token Checkout Error:", err);
    return NextResponse.json(
      { error: err.message ?? "Failed to create token checkout" },
      { status: 500 }
    );
  }
}
