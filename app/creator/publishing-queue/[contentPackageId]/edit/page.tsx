import Link from "next/link"
import { randomUUID } from "node:crypto"
import { loadCreatorPublishingComposerAccounts, loadCreatorPublishingEditablePackage } from "@/lib/creator-publishing-queue/ui/loaders"
import { PackageComposerForm } from "../../composer/PackageComposerForm"

export const metadata = { title: "Edit publishing package — Sirens Forge" }

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ contentPackageId: string }>
}) {
  const { contentPackageId } = await params
  const [accounts, pkg] = await Promise.all([
    loadCreatorPublishingComposerAccounts(),
    loadCreatorPublishingEditablePackage(contentPackageId),
  ])
  const idempotencyKey = randomUUID().replaceAll("-", "_")
  const isFanvue = pkg.target_platform === "fanvue"

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-zinc-950/80 p-6">
        <div className="flex flex-wrap gap-3 text-sm">
          {!isFanvue && (
            <Link
              href={`/creator/publishing-queue/${pkg.id}`}
              className="text-fuchsia-200 underline"
            >
              Back to package detail
            </Link>
          )}
          {isFanvue && (
            <>
              <Link
                href={`/creator/publishing-queue/fanvue/packages/${pkg.id}/media`}
                className="text-cyan-200 underline"
              >
                Manage Fanvue package media
              </Link>
              <Link href="/creator/publishing-queue/fanvue" className="text-fuchsia-200 underline">
                Fanvue publishing history
              </Link>
            </>
          )}
        </div>

        <h1 className="mt-4 text-3xl font-bold">Edit package metadata</h1>
        <p className="mt-3 text-zinc-300">
          {isFanvue
            ? "Only unlocked publishing package metadata can be changed here. Use Manage Fanvue package media to attach existing Sirens Forge-generated images or videos."
            : "Only unlocked publishing package metadata can be changed. Media selection stays on the package detail page."}
        </p>
        <PackageComposerForm accounts={accounts} initial={pkg} idempotencyKey={idempotencyKey} />
      </div>
    </main>
  )
}
