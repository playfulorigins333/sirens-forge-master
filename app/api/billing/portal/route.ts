import { NextResponse } from "next/server"
import Stripe from "stripe"
import { ensureAuthenticatedProfile } from "@/lib/account-access"
import { resolveExistingBillingCustomer } from "@/lib/stripe/billingCustomerResolver"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type BillingPortalDeps = {
  stripeSecretKey?: string
  ensureAuthenticatedProfile?: typeof ensureAuthenticatedProfile
  resolveExistingBillingCustomer?: typeof resolveExistingBillingCustomer
  createPortalSession?: (args: { customer: string; return_url: string }) => Promise<{ url: string }>
}

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

export async function executeBillingPortal(req: Request, deps: BillingPortalDeps = {}) {
  const stripeSecretKey = safeString(deps.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY)
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: "Billing portal is not configured", code: "BILLING_PORTAL_NOT_CONFIGURED" },
      { status: 500 }
    )
  }

  const authenticate = deps.ensureAuthenticatedProfile ?? ensureAuthenticatedProfile
  const resolveCustomer = deps.resolveExistingBillingCustomer ?? resolveExistingBillingCustomer
  const createPortalSession = deps.createPortalSession ?? ((args) => {
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-11-17.clover" as any,
    })
    return stripe.billingPortal.sessions.create(args)
  })
  const auth = await authenticate()

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
    const resolution = await resolveCustomer(profileId)
    if (resolution.ok === false) {
      const error = resolution.code === "BILLING_CUSTOMER_NOT_FOUND"
        ? "No existing Stripe billing account is linked to this profile yet."
        : "Billing management is temporarily unavailable."
      return NextResponse.json({ error, code: resolution.code }, { status: 409 })
    }

    const portalSession = await createPortalSession({
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

export async function POST(req: Request) {
  return executeBillingPortal(req)
}
