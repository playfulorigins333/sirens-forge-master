import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover" as any,
});

/**
 * POST /api/stripe/connect/create
 *
 * Creates a Stripe Express Connect account for the logged-in affiliate
 * and redirects them to Stripe onboarding.
 */
export async function POST(req: Request) {
  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return NextResponse.json(
        { error: "Missing user_id" },
        { status: 400 }
      );
    }

    // Load profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, stripe_connect_account_id")
      .eq("id", user_id)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    let accountId = profile.stripe_connect_account_id;

    // Create Stripe Connect account if it doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: profile.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
      });

      accountId = account.id;

      // Save account ID to profile
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_onboarded: false,
        })
        .eq("id", user_id);

      if (updateErr) {
        console.error("❌ Failed to store Stripe Connect account:", updateErr);
        return NextResponse.json(
          { error: "Failed to save Stripe Connect account" },
          { status: 500 }
        );
      }
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/affiliate`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/affiliate`,
      type: "account_onboarding",
    });

    return NextResponse.json({
      url: accountLink.url,
    });
  } catch (err: any) {
    console.error("❌ Stripe Connect create error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Stripe Connect setup failed" },
      { status: 500 }
    );
  }
}
