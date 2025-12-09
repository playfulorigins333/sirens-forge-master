import { createClient } from "@supabase/supabase-js";

// Admin Supabase (service role)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Ensure user has a row in token_balances.
 */
export async function ensureUserBalance(userId: string) {
  const { data, error } = await supabase
    .from("token_balances")
    .select("tokens")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("❌ Error checking token balance:", error);
    throw new Error("Failed to check token balance");
  }

  // Already exists → return current balance
  if (data) return data.tokens;

  // Create row with 0 tokens
  const { data: inserted, error: insertErr } = await supabase
    .from("token_balances")
    .insert([{ user_id: userId, tokens: 0 }])
    .select()
    .single();

  if (insertErr) {
    console.error("❌ Error creating initial balance:", insertErr);
    throw new Error("Failed to initialize token balance");
  }

  return inserted.tokens;
}

/**
 * Get current token balance.
 */
export async function getTokenBalance(userId: string) {
  await ensureUserBalance(userId);

  const { data, error } = await supabase
    .from("token_balances")
    .select("tokens")
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error("❌ Failed to fetch token balance:", error);
    throw new Error("Failed to fetch token balance");
  }

  return data.tokens;
}

/**
 * Set balance directly (admin or system only)
 */
export async function setTokenBalance(userId: string, amount: number) {
  const { data, error } = await supabase
    .from("token_balances")
    .update({ tokens: amount })
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to set token balance:", error);
    throw new Error("Failed to update token balance");
  }

  return data.tokens;
}
