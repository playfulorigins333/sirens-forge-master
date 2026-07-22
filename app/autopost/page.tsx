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
    <main className="relative z-10 mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center px-6 py-16 text-cyan-50">
      <section className="rounded-3xl border border-cyan-300/20 bg-cyan-950/25 p-8 shadow-2xl shadow-cyan-950/20 backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-200">AutoPost</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">AutoPost is currently unavailable</h1>
        <p className="mt-6 text-base leading-7 text-cyan-100">
          Publishing automation and scheduling are not available for customer use right now. Your existing records remain preserved.
        </p>
        <p className="mt-4 text-sm leading-6 text-cyan-200">
          No publishing, scheduling, or external-platform action can be started from this page.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 inline-flex rounded-full border border-cyan-300/30 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200 hover:bg-cyan-300/10"
        >
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
