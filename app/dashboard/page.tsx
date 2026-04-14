import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Brain,
  Wand2,
  Library,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { ensureActiveSubscription } from "@/lib/subscription-checker";

export const metadata = {
  title: "Sirens Forge — Dashboard",
};

export default async function DashboardPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/20 blur-[140px]" />
        <div className="absolute right-0 bottom-0 h-[1000px] w-[1000px] translate-x-1/2 translate-y-1/2 rounded-full bg-pink-600/20 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pt-24 pb-16 sm:px-8">
        <div className="mb-12 max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300 backdrop-blur-xl">
            <Sparkles className="h-4 w-4" />
            Member Dashboard
          </div>

          <h1 className="mb-4 text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
            Welcome to <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">Sirens Forge</span>
          </h1>

          <p className="max-w-3xl text-lg leading-relaxed font-medium text-gray-300 sm:text-xl">
            Start with guided prompt creation in Siren&apos;s Mind, jump straight into Generator,
            or review your existing creations in the Vault.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Link
            href="/sirens-mind"
            className="group relative overflow-hidden rounded-[28px] border border-purple-400/20 bg-gradient-to-br from-purple-950/40 via-black/50 to-cyan-950/20 p-8 backdrop-blur-xl transition-all hover:border-purple-300/40 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-pink-500/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                <Brain className="h-8 w-8 text-white" />
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Siren&apos;s Mind
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Best for brainstorming, refining mood, shaping concepts, and turning rough ideas into stronger prompts before creation.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Siren&apos;s Mind
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/generate"
            className="group relative overflow-hidden rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl transition-all hover:border-cyan-300/40 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-500/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
                <Wand2 className="h-8 w-8 text-white" />
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Generator
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Best for direct creation when you already know what you want and want to jump straight into generation and settings.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Generator
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/library"
            className="group relative overflow-hidden rounded-[28px] border border-white/15 bg-gradient-to-br from-white/10 to-white/5 p-8 backdrop-blur-xl transition-all hover:border-white/30 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-cyan-500/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-700 to-gray-500 shadow-lg">
                <Library className="h-8 w-8 text-white" />
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Vault
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Review your completed creations, revisit past outputs, and keep track of what you&apos;ve already generated.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Vault
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}