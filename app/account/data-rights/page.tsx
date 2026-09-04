import { redirect } from "next/navigation";
import Link from "next/link";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { getVoluntaryDeletionState, listCreatorDataExports } from "@/lib/account-data-rights";
import DataRightsClient from "./DataRightsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy & data controls — Sirens Forge" };

export default async function AccountDataRightsPage() {
  const auth = await ensureAuthenticatedProfile();
  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    throw new Error(auth.message);
  }
  const [exports, deletion] = await Promise.all([
    listCreatorDataExports(auth.user.id),
    getVoluntaryDeletionState(auth.user.id, auth.profile.id),
  ]);

  return (
    <main className="min-h-screen bg-black px-4 pb-20 pt-24 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/account" className="text-sm text-cyan-300 hover:text-cyan-200">← Account</Link>
        <div className="mt-5 mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Privacy & data controls</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Your data, your account</h1>
          <p className="mt-4 max-w-3xl text-gray-300">Request a private copy of your creator data or manage voluntary account deletion and recovery.</p>
        </div>
        <DataRightsClient initialExports={exports} initialDeletion={deletion} />
      </div>
    </main>
  );
}
