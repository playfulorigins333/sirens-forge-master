import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";

export default async function AutopostPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-50">
      <section className="mx-auto max-w-3xl rounded-3xl border border-cyan-300/20 bg-cyan-950/20 p-8 shadow-2xl shadow-cyan-950/30">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-200">AutoPost</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">AutoPost is currently unavailable</h1>
        <p className="mt-5 text-lg leading-8 text-cyan-50">
          Publishing automation and scheduling are not available for customer use right now. Your existing records remain preserved.
        </p>
        <p className="mt-4 text-base leading-7 text-cyan-100">No publishing, scheduling, or external-platform action can be started from this page.</p>
        <Link
          href="/dashboard"
          className="mt-8 inline-flex rounded-full border border-cyan-200/40 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:border-cyan-100 hover:bg-cyan-300/10"
        >
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
