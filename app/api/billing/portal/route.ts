import { NextResponse } from "next/server"
import Stripe from "stripe"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-11-17.clover" as any,
})

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function getBaseUrl(req: Request) {
  const envUrl = safeString(process.env.NEXT_PUBLIC_APP_URL)
  if (envUrl) return envUrl.replace(/\/+$/, "")

  const origin = safeString(req.headers.get("origin"))
  if (origin) return origin.replace(/\/+$/, "")

  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || ""
  return host ? `${proto}://${host}`.replace(/\/+$/, "") : ""
}

export async function POST(req: Request) {
  if (!safeString(process.env.STRIPE_SECRET_KEY)) {
    return NextResponse.json(
      { error: "Billing portal is not configured", code: "BILLING_PORTAL_NOT_CONFIGURED" },
      { status: 500 }
    )
  }

  const auth = await ensureActiveSubscription()

  if (!auth.ok) {
    const status = auth.status === 401 ? 401 : auth.status === 402 ? 402 : 403
    return NextResponse.json(
      {
        error: auth.error === "UNAUTHENTICATED" ? "Authentication required" : "Active subscription required",
        code: auth.error ?? "SUBSCRIPTION_REQUIRED",
      },
      { status }
    )
  }

  const profileId = auth.profile?.id
  if (!profileId) {
    return NextResponse.json(
      { error: "Profile not found", code: "PROFILE_NOT_FOUND" },
      { status: 403 }
    )
  }

  const baseUrl = getBaseUrl(req)
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Billing portal return URL is not configured", code: "APP_URL_NOT_CONFIGURED" },
      { status: 500 }
    )
  }

  try {
    const customer = await getOrCreateStripeCustomer(
      profileId,
      auth.user?.email ?? auth.profile?.email ?? undefined
    )

    const portalSession = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${baseUrl}/billing`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (err: any) {
    console.error("❌ Billing portal route error:", err)
    return NextResponse.json(
      { error: "Could not open billing portal", code: "BILLING_PORTAL_FAILED" },
      { status: 500 }
    )
  }
}
