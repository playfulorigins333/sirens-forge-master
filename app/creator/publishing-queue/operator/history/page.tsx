import Link from "next/link"
import { loadOperatorOnlyFansTerminalHistory } from "@/lib/creator-publishing-queue/onlyfans-history/loaders"
import { formatHistoryTimestamp } from "@/lib/creator-publishing-queue/onlyfans-history/timezone"

export const metadata = { title: "OnlyFans completed history — Sirens Forge" }

type PageProps = {
  searchParams: Promise<{ cursor?: string | string[] }>
}

export default async function OnlyFansOperatorTerminalHistoryPage({ searchParams }: PageProps) {
  const params = await searchParams
  const cursor = typeof params.cursor === "string" ? params.cursor : null
  const result = await loadOperatorOnlyFansTerminalHistory(cursor)

  return <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6 lg:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href="/creator/publishing-queue/operator" className="text-sm text-fuchsia-200 underline">Back to operator queue</Link>
      <p className="mt-6 text-sm uppercase tracking-[0.3em] text-cyan-200">OnlyFans assisted operator</p>
      <h1 className="mt-3 text-4xl font-bold">Completed and terminal history</h1>
      {"message" in result ? <p className="mt-6 rounded-2xl border border-amber-300/40 bg-amber-950/30 p-5 text-amber-100">{result.message}</p> : result.jobs.length===0 ? <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-zinc-400"><p>No authorized terminal OnlyFans jobs were found on this page.</p>{result.hasPreviousPage ? <Link href="/creator/publishing-queue/operator/history" className="mt-4 inline-block text-cyan-200 underline">Return to newest records</Link> : null}</div> : <>
        <ol className="mt-6 space-y-3">
          {result.jobs.map(job=><li key={job.platformJobId} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <article className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">{job.statusLabel}</h2>
                <p className="text-sm text-zinc-400">Job {job.platformJobId}</p>
                <dl className="mt-2 text-sm">
                  <div>
                    <dt className="text-zinc-500">Last updated</dt>
                    <dd><time dateTime={job.updatedAt} className="text-cyan-100">{formatHistoryTimestamp(job.updatedAt, job.timezone)}</time> <span className="text-zinc-500">({job.timezone})</span></dd>
                  </div>
                </dl>
              </div>
              <Link href={`/creator/publishing-queue/operator/history/${job.platformJobId}`} className="rounded-xl border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-200">View history</Link>
            </article>
          </li>)}
        </ol>
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Terminal history pages">
          {result.hasPreviousPage ? <Link href="/creator/publishing-queue/operator/history" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-zinc-200 focus:outline-none focus:ring-2 focus:ring-cyan-200">Return to newest</Link> : <span/>}
          {result.nextCursor ? <Link href={`/creator/publishing-queue/operator/history?cursor=${encodeURIComponent(result.nextCursor)}`} rel="next" className="rounded-xl border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-200">Next page</Link> : <p className="text-sm text-zinc-500">End of authorized history</p>}
        </nav>
      </>}
    </div>
  </main>
}
