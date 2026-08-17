"use client"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { GeneratedMediaCandidate } from "@/lib/creator-publishing-queue/ui/loaders"

const defaultWarning = "Adding generated media changes the package manifest. Compliance review and creator approval may need to be completed again before handoff."
const defaultSuccessCopy = "Sirens Forge-generated media was added successfully. The package has been refreshed so the current media manifest and approval status can be reviewed."

export function GeneratedMediaSelectionPanel({
  contentPackageId,
  candidates,
  allowed,
  blockedReason,
  warningText = defaultWarning,
  successText = defaultSuccessCopy,
}: {
  contentPackageId: string
  candidates: GeneratedMediaCandidate[]
  allowed: boolean
  blockedReason: string | null
  warningText?: string
  successText?: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [status, setStatus] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const selectable = useMemo(() => candidates.filter((candidate) => !candidate.alreadyAttached), [candidates])

  async function submit() {
    setSuccess(false)
    let any = false
    for(const id of selected) {
      setStatus((current) => ({ ...current, [id]: "pending" }))
      try {
        const response = await fetch("/api/creator-publishing-queue/media/generated-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentPackageId, generationId: id }),
        })
        if (!response.ok) {
          throw new Error((await response.json().catch(() => ({ error: "FAILED" }))).error || "FAILED")
        }
        setStatus((current) => ({ ...current, [id]: "success" }))
        any = true
      } catch {
        setStatus((current) => ({ ...current, [id]: "failure" }))
      }
    }
    if (any) {
      setSuccess(true)
      setSelected([])
      router.refresh()
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-white">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">Generated media</p>
          <h2 className="mt-1 text-2xl font-semibold">Add existing Sirens Forge media</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-300">
            Choose only from completed media generated inside Sirens Forge. Local files, camera uploads, and creator-supplied storage details are not accepted here.
          </p>
        </div>
        <span className="rounded-full border border-cyan-300/30 bg-cyan-950/30 px-3 py-1 text-xs text-cyan-100">
          Images and videos
        </span>
      </div>

      <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-950/30 p-3 text-sm text-amber-100">
        {warningText}
      </p>
      {blockedReason && (
        <p className="mt-3 rounded-2xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">
          {blockedReason}
        </p>
      )}
      {success && (
        <p role="status" className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          {successText}
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
          No eligible Sirens Forge-generated media is available for this package.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((candidate) => (
            <label
              key={candidate.generationId}
              className="rounded-2xl border border-white/10 bg-black/40 p-3 focus-within:ring-2 focus-within:ring-fuchsia-300"
            >
              <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
                {candidate.kind === "image" ? (
                  <img
                    src={candidate.previewUrl}
                    alt={`Generated image preview created ${candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : "at an unknown time"}`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <video
                    controls
                    src={candidate.previewUrl}
                    className="h-full w-full"
                    aria-label={`Generated video preview created ${candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : "at an unknown time"}`}
                  />
                )}
              </div>
              <div className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-black text-fuchsia-500 focus:ring-fuchsia-300"
                  disabled={!allowed || candidate.alreadyAttached || status[candidate.generationId] === "pending"}
                  checked={selected.includes(candidate.generationId)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, candidate.generationId]
                        : current.filter((id) => id !== candidate.generationId),
                    )
                  }
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-white">
                    {candidate.kind === "video" ? "Video" : "Image"}
                    {candidate.alreadyAttached ? " · already attached" : ""}
                  </p>
                  <p className="mt-1 text-zinc-300">{candidate.promptExcerpt || "No prompt text available."}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : "Unknown date"}
                    {candidate.mode ? ` · ${candidate.mode}` : ""}
                  </p>
                  {status[candidate.generationId] && (
                    <p
                      className={`mt-2 text-xs ${
                        status[candidate.generationId] === "success"
                          ? "text-emerald-300"
                          : status[candidate.generationId] === "failure"
                            ? "text-rose-300"
                            : "text-cyan-300"
                      }`}
                    >
                      {status[candidate.generationId]}
                    </p>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!allowed || selected.length === 0 || selected.some((id) => status[id] === "pending")}
          className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add selected generated media
        </button>
        <p aria-live="polite" className="text-sm text-zinc-400">
          {selectable.length} unattached eligible item{selectable.length === 1 ? "" : "s"} available.
        </p>
      </div>
    </section>
  )
}
