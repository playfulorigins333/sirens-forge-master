import { getTokenBalance, setTokenBalance } from "./index";
import { recordTokenEvent } from "./history";

/**
 * Add tokens to user balance.
 */
export async function addTokens(userId: string, amount: number, reason: string) {
  const current = await getTokenBalance(userId);
  const newBalance = current + amount;

  await setTokenBalance(userId, newBalance);

  await recordTokenEvent(userId, amount, reason, newBalance);

  return newBalance;
}

/**
 * Subtract tokens safely (never below zero).
 */
export async function subtractTokens(
  userId: string,
  amount: number,
  reason: string
) {
  const current = await getTokenBalance(userId);

  if (current < amount) {
    throw new Error("Insufficient tokens");
  }

  const newBalance = current - amount;

  await setTokenBalance(userId, newBalance);

  await recordTokenEvent(userId, -amount, reason, newBalance);

  return newBalance;
}
