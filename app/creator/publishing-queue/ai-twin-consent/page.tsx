import { randomUUID } from "node:crypto"
import Link from "next/link"
import { loadAiTwinConsentView } from "@/lib/creator-publishing-queue/consent/loaders"
import { AiTwinConsentForm } from "./AiTwinConsentForm"

export const metadata = { title: "AI content & persona consent — Sirens Forge" }

export default async function AiTwinConsentPage() {
  const view = await loadAiTwinConsentView()
  const grantIdempotencyKey = randomUUID()
  const revokeIdempotencyKey = randomUUID()
  const consentStateKey = [view.consentStatus, view.attestationVersion ?? "no-version", view.updatedAt ?? "not-recorded"].join(":")

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/creator/publishing-queue" className="text-sm text-fuchsia-200 underline">
          Back to publishing queue
        </Link>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">Creator Publishing Queue</p>
          <h1 className="mt-2 text-3xl font-bold">AI content & persona consent</h1>

          <div className="mt-4 grid gap-3 text-zinc-300">
            <p>This consent records your authorization for Sirens Forge to prepare AI-generated content for supported creator publishing workflows.</p>
            <p><strong className="text-white">OnlyFans:</strong> the launch workflow is likeness-bound. AI content prepared for OnlyFans must depict you as the verified creator and cannot substitute a different fictional model for your identity.</p>
            <p><strong className="text-white">Fanvue:</strong> your Fanvue account is owned and verified by you, but the AI model does not have to look like you. You may use a fully synthetic fictional model, a different appearance, or a separate niche/persona that is not based on your likeness.</p>
            <p>Using another real person&apos;s likeness or body is separate from creating a fully synthetic persona and remains subject to the required consent and verification rules.</p>
            <p>This consent does not change LoRA trainer uploads, expose LoRA training images, activate a publishing destination, authorize a specific post, or by itself grant Sirens Forge access to an external platform account.</p>
            <p>You may revoke this consent at any time.</p>
          </div>
        </section>

        <div className="mt-8">
          <AiTwinConsentForm key={consentStateKey} view={view} grantIdempotencyKey={grantIdempotencyKey} revokeIdempotencyKey={revokeIdempotencyKey} />
        </div>
      </div>
    </main>
  )
}
