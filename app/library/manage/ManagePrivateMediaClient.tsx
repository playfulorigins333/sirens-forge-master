"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ManagedAsset = {
  id: string;
  kind: "image" | "video";
  prompt: string;
  createdAt: string;
};

async function trashAsset(assetId: string) {
  const response = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/trash`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "LIFECYCLE_UNAVAILABLE");
}

async function downloadAsset(assetId: string) {
  const response = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/signed-url?mode=download`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("DOWNLOAD_UNAVAILABLE");
  const body = await response.json() as { url?: unknown };
  if (typeof body.url !== "string") throw new Error("DOWNLOAD_UNAVAILABLE");
  window.location.assign(body.url);
}

export default function ManagePrivateMediaClient({ items }: { items: ManagedAsset[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (item: ManagedAsset) => {
    if (!window.confirm("Move this media to Recently Deleted? You can restore it during the 30-day recovery window.")) return;
    setBusyId(item.id);
    setError(null);
    try {
      await trashAsset(item.id);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LIFECYCLE_UNAVAILABLE");
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="text-sm uppercase tracking-[0.2em] text-purple-300">Private Library</p>
          <h1 className="mt-2 text-3xl font-bold">Manage private media</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-300">Move generated private images or videos into Recently Deleted. Trashed media stays recoverable for 30 days unless you permanently delete it sooner.</p>
          <Link className="mt-4 inline-block text-sm text-purple-200 underline" href="/library">Back to Creation Loop</Link>
        </header>

        {error ? <div className="rounded-xl border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</div> : null}
        {items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-8 text-center text-gray-400">No active private media to manage.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
                <div className="aspect-[4/5] bg-gray-900">
                  {item.kind === "video" ? (
                    <video className="h-full w-full object-cover" controls preload="metadata" src={`/api/library/assets/${item.id}/signed-url?mode=preview&delivery=redirect`} />
                  ) : (
                    <img className="h-full w-full object-cover" src={`/api/library/assets/${item.id}/signed-url?mode=preview&delivery=redirect`} alt="Private creation" />
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <p className="line-clamp-2 text-sm text-gray-100">{item.prompt || "(No prompt saved)"}</p>
                  <p className="text-xs text-gray-400">Created {new Date(item.createdAt).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => void downloadAsset(item.id).catch(() => setError("DOWNLOAD_UNAVAILABLE"))}>
                      <Download className="mr-2 h-4 w-4" /> Download
                    </Button>
                    <Button size="sm" disabled={busyId === item.id} onClick={() => void remove(item)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
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
