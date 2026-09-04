import Link from "next/link"
import { GeneratedMediaSelectionPanel } from "../../../../[contentPackageId]/GeneratedMediaSelectionPanel"
import { loadCreatorFanvuePackageMedia } from "@/lib/creator-publishing-queue/fanvue/phase7PackageMedia"

export const metadata = { title: "Fanvue package media — Sirens Forge" }

export default async function FanvuePackageMediaPage({
  params,
}: {
  params: Promise<{ contentPackageId: string }>
}) {
  const { contentPackageId } = await params
  const view = await loadCreatorFanvuePackageMedia(contentPackageId)

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={`/creator/publishing-queue/${view.pkg.id}/edit`}
            className="text-fuchsia-200 underline focus:outline-none focus:ring-2 focus:ring-fuchsia-200"
          >
            Back to package editor
          </Link>
          <Link
            href="/creator/publishing-queue/fanvue"
            className="text-cyan-200 underline focus:outline-none focus:ring-2 focus:ring-cyan-200"
          >
            Fanvue publishing history
          </Link>
        </div>

        <header className="mt-6 rounded-3xl border border-cyan-300/20 bg-cyan-950/15 p-6">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">
            Fanvue package preparation
          </p>
          <h1 className="mt-2 text-3xl font-bold">{view.pkg.title}</h1>
          <p className="mt-3 max-w-3xl text-zinc-300">
            Add existing Sirens Forge-generated media to this owned Fanvue package. This page prepares the package only; it does not schedule, publish, call Fanvue, or activate public Fanvue posting.
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            Package updated {new Date(view.pkg.updatedAt).toLocaleString()} · Approval state {view.pkg.creatorApprovalStatus}
          </p>
        </header>

        <GeneratedMediaSelectionPanel
          contentPackageId={view.pkg.id}
          candidates={view.generatedMediaCandidates}
          allowed={view.generatedMediaSelectionAllowed}
          blockedReason={view.generatedMediaSelectionBlockedReason}
          warningText="Adding generated media changes this Fanvue package manifest. Public scheduling and posting remain disabled until the separate final activation gate."
          successText="Sirens Forge-generated media was added to the Fanvue package. The private package preview has been refreshed; nothing was scheduled or published."
        />

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-2xl font-semibold">Attached media</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Previews use short-lived server-signed access to private package media.
          </p>
          {view.media.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
              No media is attached to this Fanvue package yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {view.media.map((asset, index) => (
                <figure key={asset.id} className="rounded-2xl border border-white/10 bg-black/40 p-3">
                  <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
                    {asset.signedUrl && asset.mimeType.startsWith("image/") ? (
                      <img
                        src={asset.signedUrl}
                        alt={`Fanvue package media ${index + 1}`}
                        className="h-full w-full object-contain"
                      />
                    ) : asset.signedUrl && asset.mimeType.startsWith("video/") ? (
                      <video
                        controls
                        src={asset.signedUrl}
                        className="h-full w-full"
                        aria-label={`Fanvue package video ${index + 1}`}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-zinc-400">
                        Preview unavailable. File: {asset.mimeType}
                      </div>
                    )}
                  </div>
                  <figcaption className="mt-3 text-xs text-zinc-400">
                    #{index + 1} · {asset.mimeType} · SHA-256 {asset.sha256.slice(0, 12)}…
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
