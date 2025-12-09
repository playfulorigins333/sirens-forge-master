import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Use Clover API version required by your Stripe SDK
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

// Service role Supabase client (needed to update profiles table)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getOrCreateStripeCustomer(userId: string, email?: string) {
  // 1. Load user profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error("❌ Error loading profile:", profileError);
    throw new Error("Failed to load user profile");
  }

  // 2. If customer already exists → return it immediately
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // 3. Create new Stripe customer
  const customer = await stripe.customers.create({
    email: email ?? profile.email,
    metadata: {
      user_id: userId,
    },
  });

  // 4. Save Stripe customer ID into Supabase
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  if (updateError) {
    console.error("❌ Failed to save Stripe customer ID:", updateError);
    throw new Error("Could not save Stripe customer ID");
  }

  console.log("✨ Created new Stripe customer:", customer.id);

  return customer.id;
}
