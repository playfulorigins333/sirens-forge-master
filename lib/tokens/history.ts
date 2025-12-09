import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Record token usage (add or subtract).
 */
export async function recordTokenEvent(
  userId: string,
  amount: number,
  reason: string,
  resultingBalance: number
) {
  const { error } = await supabase.from("token_history").insert([
    {
      user_id: userId,
      amount,
      reason,
      balance_after: resultingBalance,
    },
  ]);

  if (error) {
    console.error("❌ Error recording token event:", error);
    throw new Error("Failed to log token history");
  }
}

/**
 * Fetch last X token events.
 */
export async function getTokenHistory(userId: string, limit = 50) {
  const { data, error } = await supabase
    .from("token_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("❌ Error fetching token history:", error);
    throw new Error("Failed to fetch history");
  }

  return data;
}
