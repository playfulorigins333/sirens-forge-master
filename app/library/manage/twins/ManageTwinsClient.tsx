"use client";

import { useState } from "react";
import Link from "next/link";
import { Database, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ManagedTwin = {
  id: string;
  name: string;
  status: string;
  trainingDataState: "active" | "purge_pending" | "purged";
  createdAt: string | null;
  hasArtifact: boolean;
  hasTrainingData: boolean;
};

async function post(twinId: string, path: "trash" | "training-data/purge") {
  const response = await fetch(`/api/library/twins/${encodeURIComponent(twinId)}/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "LIFECYCLE_UNAVAILABLE");
}

export default function ManageTwinsClient({ items }: { items: ManagedTwin[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moveToTrash = async (item: ManagedTwin) => {
    if (!window.confirm("Move this AI Twin to Recently Deleted? It can be restored for 30 days. Existing generated media will remain, but this Twin cannot be used for new generation while trashed.")) return;
    setBusyId(item.id); setError(null);
    try { await post(item.id, "trash"); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "LIFECYCLE_UNAVAILABLE"); setBusyId(null); }
  };

  const deleteTrainingData = async (item: ManagedTwin) => {
    if (!window.confirm("Permanently delete this AI Twin's training photos and Dataset Doctor data? This does NOT delete the trained Twin or existing generated media, and cannot be undone.")) return;
    setBusyId(item.id); setError(null);
    try { await post(item.id, "training-data/purge"); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "LIFECYCLE_UNAVAILABLE"); setBusyId(null); }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-sm uppercase tracking-[0.2em] text-purple-300">Private Library</p>
          <h1 className="mt-2 text-3xl font-bold">Manage AI Twins</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-300">Twin deletion and training-data deletion are separate. Removing training photos does not remove the trained Twin. Moving a Twin to Trash starts its 30-day recovery window.</p>
          <div className="mt-4 flex gap-4 text-sm">
            <Link className="text-purple-200 underline" href="/library/manage">Manage private media</Link>
            <Link className="text-purple-200 underline" href="/library/recently-deleted/twins">Recently Deleted Twins</Link>
          </div>
        </header>
        {error ? <div className="rounded-xl border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</div> : null}
        {items.length === 0 ? <div className="rounded-2xl border border-gray-800 bg-gray-950 p-8 text-center text-gray-400">No active AI Twins to manage.</div> : (
          <div className="space-y-4">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="font-semibold">{item.name}</h2>
                    <p className="mt-1 text-xs text-gray-400">Status: {item.status} · Training data: {item.trainingDataState}{item.createdAt ? ` · Created ${new Date(item.createdAt).toLocaleString()}` : ""}</p>
                    <p className="mt-2 text-xs text-gray-500">{item.hasArtifact ? "Trained artifact present" : "No trained artifact"} · {item.trainingDataState === "purged" ? "Training data deleted" : item.hasTrainingData ? "Training dataset reference present" : "No current dataset reference"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busyId === item.id || item.trainingDataState === "purge_pending" || item.trainingDataState === "purged"} onClick={() => void deleteTrainingData(item)}>
                      <Database className="mr-2 h-4 w-4" /> {item.trainingDataState === "purge_pending" ? "Deletion pending" : item.trainingDataState === "purged" ? "Training data deleted" : "Delete training data"}
                    </Button>
                    <Button size="sm" disabled={busyId === item.id} onClick={() => void moveToTrash(item)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Move Twin to Trash
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
