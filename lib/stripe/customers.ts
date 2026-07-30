import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2025-11-17.clover",
  });
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin env for Stripe customer lookup");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getOrCreateStripeCustomer(userId: string, email?: string) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();

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
      profile_id: userId,
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
