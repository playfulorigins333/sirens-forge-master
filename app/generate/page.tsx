import Link from "next/link";

export default function GeneratePage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] px-6 py-16 text-white">
      <section className="mx-auto flex max-w-3xl flex-col items-start rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/30 md:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-200">
          Generate
        </p>
        <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
          Generation is currently unavailable
        </h1>
        <p className="mt-6 text-lg leading-8 text-zinc-200">
          Image and video generation are not available for customer use right
          now. Your existing generated media remains preserved.
        </p>
        <p className="mt-4 text-base leading-7 text-zinc-300">
          No generation request or AutoPost handoff can be started from this
          page.
        </p>
        <Link
          href="/library"
          className="mt-8 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#0b0b12] transition hover:bg-zinc-200"
        >
          View your library
        </Link>
      </section>
    </main>
  );
}
