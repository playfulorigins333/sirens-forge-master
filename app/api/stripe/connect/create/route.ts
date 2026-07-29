import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { supabaseServer } from "@/lib/supabaseServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ConnectDependencies = {
  getAuthenticatedUserId: () => Promise<string | null>
  getAdminClient: () => any
  createStripeClient: (secretKey: string) => Pick<Stripe, "accounts" | "accountLinks">
  getConfiguration: () => { stripeSecretKey?: string; appUrl?: string }
}

const productionDependencies: ConnectDependencies = {
  getAuthenticatedUserId: async () => {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.auth.getUser()
    return error || !data.user?.id ? null : data.user.id
  },
  getAdminClient: getSupabaseAdmin,
  createStripeClient: (secretKey) =>
    new Stripe(secretKey, { apiVersion: "2025-11-17.clover" as any }),
  getConfiguration: () => ({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  }),
}

const jsonError = (error: string, status: number) =>
  NextResponse.json({ error }, { status })

/**
 * Dependency-injected implementation keeps authentication and provider boundaries
 * locally testable without weakening the production route.
 */
export async function createStripeConnectResponse(
  _req: Request,
  dependencies: ConnectDependencies,
) {
  let authenticatedUserId: string | null

  try {
    authenticatedUserId = await dependencies.getAuthenticatedUserId()
  } catch {
    return jsonError("Unauthorized", 401)
  }

  // Do not construct either privileged client until the server session is verified.
  if (!authenticatedUserId) return jsonError("Unauthorized", 401)

  let admin: any
  try {
    admin = dependencies.getAdminClient()
  } catch {
    return jsonError("Stripe Connect configuration unavailable", 503)
  }

  let profiles: any[] | null
  try {
    const result = await admin
      .from("profiles")
      .select("id, user_id, email, stripe_connect_account_id")
      .eq("user_id", authenticatedUserId)
      .limit(2)

    if (result.error) return jsonError("Unable to resolve affiliate profile", 500)
    profiles = result.data
  } catch {
    return jsonError("Unable to resolve affiliate profile", 500)
  }

  if (!profiles || profiles.length === 0) {
    return jsonError("Affiliate profile not found", 404)
  }
  if (
    profiles.length !== 1 ||
    !profiles[0]?.id ||
    profiles[0].user_id !== authenticatedUserId
  ) {
    return jsonError("Unable to resolve affiliate profile", 409)
  }

  const profile = profiles[0]
  let stripeSecretKey: string | undefined
  let appUrl: string | undefined
  try {
    const configuration = dependencies.getConfiguration()
    stripeSecretKey = configuration.stripeSecretKey
    appUrl = configuration.appUrl
  } catch {
    return jsonError("Stripe Connect configuration unavailable", 503)
  }
  if (!stripeSecretKey || !appUrl) {
    return jsonError("Stripe Connect configuration unavailable", 503)
  }

  let stripe: Pick<Stripe, "accounts" | "accountLinks">
  try {
    stripe = dependencies.createStripeClient(stripeSecretKey)
  } catch {
    return jsonError("Stripe Connect configuration unavailable", 503)
  }

  let accountId = profile.stripe_connect_account_id as string | null

  try {
    if (!accountId) {
      // This is the only account-creation site in the request.
      const account = await stripe.accounts.create({
        type: "express",
        email: profile.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
      })
      accountId = account.id

      const updateResult = await admin
        .from("profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_onboarded: false,
        })
        .eq("id", profile.id)
        .eq("user_id", authenticatedUserId)
        .select("id")

      if (
        updateResult.error ||
        !Array.isArray(updateResult.data) ||
        updateResult.data.length !== 1 ||
        updateResult.data[0]?.id !== profile.id
      ) {
        return jsonError("Unable to save Stripe Connect account", 500)
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/affiliate`,
      return_url: `${appUrl}/affiliate`,
      type: "account_onboarding",
    })

    return NextResponse.json({ url: accountLink.url })
  } catch {
    return jsonError("Unable to start Stripe Connect onboarding", 502)
  }
}

/** Creates or reuses Stripe Connect for the server-authenticated affiliate. */
export async function POST(req: Request) {
  return createStripeConnectResponse(req, productionDependencies)
}
