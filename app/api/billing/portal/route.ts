import { NextResponse } from "next/server"
import Stripe from "stripe"
import { ensureAuthenticatedProfile } from "@/lib/account-access"
import { resolveExistingBillingCustomer } from "@/lib/stripe/billingCustomerResolver"

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

  const auth = await ensureAuthenticatedProfile()

  if (auth.ok === false) {
    return NextResponse.json(
      {
        error: auth.error === "UNAUTHENTICATED" ? "Authentication required" : "Profile unavailable",
        code: auth.error,
      },
      { status: auth.status }
    )
  }

  const profileId = auth.profile.id

  const baseUrl = getBaseUrl(req)
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Billing portal return URL is not configured", code: "APP_URL_NOT_CONFIGURED" },
      { status: 500 }
    )
  }

  try {
    const resolution = await resolveExistingBillingCustomer(profileId)
    if (resolution.ok === false) {
      const error = resolution.code === "BILLING_CUSTOMER_NOT_FOUND"
        ? "No existing Stripe billing account is linked to this profile yet."
        : "Billing management is temporarily unavailable."
      return NextResponse.json({ error, code: resolution.code }, { status: 409 })
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: resolution.customerId,
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
