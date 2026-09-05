import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { paymentFirstWebhook, type PaymentV2Database, type PaymentV2Provider, type PaymentV2Tier } from "@/lib/payment-v2/webhookService";
import type { PaymentV2InboxDatabase } from "@/lib/payment-v2/eventInboxService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await paymentFirstWebhook({
    enabled: process.env.PAYMENT_FIRST_WEBHOOK_V2_ENABLED,
    inboxEnabled: process.env.PAYMENT_V2_EVENT_INBOX_ENABLED,
    apiKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_PAYMENT_V2_WEBHOOK_SECRET,
    signature: request.headers.get("stripe-signature"),
    readRawBody: async () => Buffer.from(await request.arrayBuffer()),
    createProvider(apiKey): PaymentV2Provider {
      const stripe = new Stripe(apiKey, { apiVersion: "2025-11-17.clover" as Stripe.LatestApiVersion });
      return {
        constructEvent: (raw, signature, secret) => stripe.webhooks.constructEvent(Buffer.from(raw), signature, secret) as any,
        retrieveSession: (id) => stripe.checkout.sessions.retrieve(id, { expand: ["line_items.data.price"] }) as any,
        retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }) as any,
        retrieveSubscription: (id) => stripe.subscriptions.retrieve(id, { expand: ["items.data.price", "latest_invoice"] }) as any,
        retrieveInvoice: (id)=>stripe.invoices.retrieve(id) as any,
        async listInvoicePayments(id){return await stripe.invoicePayments.list({invoice:id,status:"paid",limit:100}).autoPagingToArray({limit:1000}) as any;},
        async listPaidInvoices(id) { return await stripe.invoices.list({ subscription: id, status: "paid", limit: 100 }).autoPagingToArray({ limit: 10000 }) as any; },
      };
    },
    createDatabase(): PaymentV2Database {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      if (!url || !key) throw new Error("configuration unavailable");
      const db = createClient(url, key, { auth: { persistSession: false } });
      const rows = async (query: PromiseLike<any>) => { const { data, error } = await query; if (error) throw new Error("database operation failed"); return data || []; };
      return {
        loadHold: (id) => rows(db.from("payment_v2_holds").select("id,state,tier,expires_at,stripe_checkout_session_id,purchaser_credential_hash").eq("id", id)) as any,
        loadTier: (name: PaymentV2Tier) => rows(db.from("subscription_tiers").select("name,is_active,stripe_price_id").eq("name", name)) as any,
        loadPurchase: (holdId) => rows(db.from("payment_v2_purchases").select("hold_id,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_payment_intent_id,stripe_subscription_id").eq("hold_id", holdId)) as any,
        async recordPaid(args) { const { data, error } = await db.rpc("payment_v2_record_paid_with_charge", { ...args, p_purchaser_hash: `\\x${Buffer.from(args.p_purchaser_hash as Uint8Array).toString("hex")}` }); if (error) throw new Error(error.message.includes("purchase_conflict") ? "paid_purchase_conflict" : "paid recording failed"); return data; },
        async recordTerminal(args) { const { data, error } = await db.rpc("payment_v2_record_session_unpaid_terminal", args); if (error) throw new Error(error.message.includes("paid_purchase_exists") ? "paid_purchase_exists" : "terminal recording failed"); return data; },
        async reconcilePaidInvoices(args) { const { data, error } = await db.rpc("payment_v2_reconcile_paid_invoices", args); if (error) throw new Error("recurring invoice reconciliation failed"); return data; },
        async applyEarlyBirdLifecycle(args) { const { data, error } = await db.rpc("payment_v2_apply_early_bird_subscription_lifecycle", args); if (error) throw new Error(error.message); return data; },
        async recordSubscriptionPaymentFailure(args) { const { data, error } = await db.rpc("payment_v2_record_subscription_payment_failure", args); if (error) throw new Error(error.message); return data; },
        async recoverSubscriptionPaymentDelinquency(args) { const { data, error } = await db.rpc("payment_v2_recover_subscription_payment_delinquency", args); if (error) throw new Error(error.message); return data; },
      };
    },
    createInboxDatabase(): PaymentV2InboxDatabase {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      if (!url || !key) throw new Error("configuration unavailable");
      const db = createClient(url, key, { auth: { persistSession: false } });
      return {
        async receiveEvent(args) { const { data, error } = await db.rpc("payment_v2_inbox_receive_event", args); if (error) throw new Error(error.message.includes("inbox_event_conflict") ? "inbox_event_conflict" : "inbox receive failed"); return data; },
        async transitionStatus(args) { const { data, error } = await db.rpc("payment_v2_inbox_transition_status", args); if (error) throw new Error("inbox transition failed"); return data; },
      };
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
