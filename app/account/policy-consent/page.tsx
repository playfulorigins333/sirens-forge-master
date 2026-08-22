import { redirect } from "next/navigation"
import { PolicyConsentForm } from "./PolicyConsentForm"
import { currentAcceptanceForAuthenticatedUser } from "@/lib/material-policy/service"
import { safeInternalNext } from "@/lib/material-policy/redirect"
import { MATERIAL_POLICY_MANIFEST } from "@/lib/material-policy/manifest"

export const dynamic = "force-dynamic"

export default async function PolicyConsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const state = await currentAcceptanceForAuthenticatedUser()
  if (!state.authenticated) redirect("/login")
  const next = safeInternalNext((await searchParams).next)
  return <main className="min-h-screen bg-black px-4 py-28 text-white"><section className="mx-auto max-w-2xl rounded-3xl border border-cyan-400/20 bg-white/5 p-8">
    <p className="mb-3 text-xs uppercase tracking-widest text-cyan-300">Material policy acceptance</p>
    <h1 className="mb-4 text-3xl font-black">Review and accept the current policies</h1>
    <p className="mb-8 text-sm text-gray-400">Bundle {MATERIAL_POLICY_MANIFEST.materialBundleVersion}. This receipt records the policy versions accepted; it is not a claim of legal sufficiency.</p>
    <PolicyConsentForm next={next} alreadyAccepted={state.accepted} />
  </section></main>
}
