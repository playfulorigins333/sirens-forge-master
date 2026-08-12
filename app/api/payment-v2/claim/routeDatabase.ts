import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { ClaimDatabase } from "@/lib/payment-v2/claimService";

export function claimDatabase(): ClaimDatabase {
  const db = getSupabaseAdmin();
  const rows = async (query: PromiseLike<any>) => { const { data, error } = await query; if (error) throw new Error("database operation failed"); return data || []; };
  const bytea = (value: Uint8Array) => `\\x${Buffer.from(value).toString("hex")}`;
  return {
    loadHolds: (session, hash) => rows(db.from("payment_v2_holds").select("id,purchaser_credential_hash,tier,state,stripe_checkout_session_id").eq("stripe_checkout_session_id", session).eq("purchaser_credential_hash", bytea(hash))),
    loadPurchases: (hold, session, hash) => rows(db.from("payment_v2_purchases").select("id,hold_id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,stripe_subscription_id,stripe_customer_id,stripe_price_id,claimed_profile_id").eq("hold_id", hold).eq("stripe_checkout_session_id", session).eq("purchaser_credential_hash", bytea(hash))),
    loadAllocations: (purchase) => rows(db.from("payment_v2_allocations").select("purchase_id,tier,profile_id,entitlement_id").eq("purchase_id", purchase)),
    loadEntitlements: (id) => rows(db.from("user_subscriptions").select("id,user_id,tier_name,status").eq("id", id)),
    loadProfiles: (user) => rows(db.from("profiles").select("id,user_id").eq("user_id", user)),
    async claim(args) { const { data, error } = await db.rpc("payment_v2_claim", { ...args, p_purchaser_hash: bytea(args.p_purchaser_hash) }); if (error) throw new Error("claim failed"); return data; },
  } as ClaimDatabase;
}
