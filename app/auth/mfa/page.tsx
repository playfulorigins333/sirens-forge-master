import { redirect } from "next/navigation"
import { supabaseServer } from "@/lib/supabaseServer"
import { safeInternalNext } from "@/lib/material-policy/redirect"
import MfaChallenge from "./MfaChallenge"

export const dynamic = "force-dynamic"

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) return <main className="p-8 text-white">Security verification is temporarily unavailable.</main>
  const factors = data.totp.filter((factor) => factor.status === "verified").map(({ id, friendly_name }) => ({ id, friendlyName: friendly_name ?? "Authenticator" }))
  const next = safeInternalNext((await searchParams).next)
  if (!factors.length) redirect(`/account/security?next=${encodeURIComponent(next)}`)
  return <MfaChallenge factors={factors} next={next} />
}
