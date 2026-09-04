"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type DeletedAsset = {
  id: string;
  generationId: string;
  kind: "image" | "video";
  prompt: string;
  lifecycleState: "trashed" | "purge_pending";
  trashedAt: string | null;
  purgeAfter: string | null;
};

async function postLifecycle(assetId: string, action: "restore" | "purge") {
  const response = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/${action}`, {
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

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function RecentlyDeletedClient({ items }: { items: DeletedAsset[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (item: DeletedAsset, action: "restore" | "purge") => {
    if (action === "purge" && !window.confirm("Permanently delete this media now? This cannot be undone.")) return;
    setBusyId(item.id);
    setError(null);
    try {
      await postLifecycle(item.id, action);
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
          <h1 className="mt-2 text-3xl font-bold">Recently Deleted</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-300">
            Deleted media stays recoverable for 30 days. Restore it here, or permanently delete it now. The automatic day-30 purge scheduler is a Phase 8 responsibility and is not claimed complete here.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link className="text-purple-200 underline" href="/library">Back to Creation Loop</Link>
            <Link className="text-purple-200 underline" href="/library/recently-deleted/twins">Recently Deleted AI Twins</Link>
          </div>
        </header>

        {error ? <div className="rounded-xl border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</div> : null}

        {items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-8 text-center text-gray-400">Recently Deleted is empty.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const pending = item.lifecycleState === "purge_pending";
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
                  <div className="aspect-[4/5] bg-gray-900">
                    {pending ? (
                      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-amber-200">Permanent deletion is pending. Preview is disabled while the delete handshake is retryable.</div>
                    ) : item.kind === "video" ? (
                      <video className="h-full w-full object-cover" controls preload="metadata" src={`/api/library/assets/${item.id}/signed-url?mode=preview&delivery=redirect`} />
                    ) : (
                      <img className="h-full w-full object-cover" src={`/api/library/assets/${item.id}/signed-url?mode=preview&delivery=redirect`} alt="Recently deleted creation" />
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <p className="line-clamp-2 text-sm text-gray-100">{item.prompt || "(No prompt saved)"}</p>
                    <div className="text-xs text-gray-400">
                      <div>Deleted: {formatDate(item.trashedAt)}</div>
                      <div>{pending ? "Deletion pending" : `Purge eligible after: ${formatDate(item.purgeAfter)}`}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!pending ? (
                        <>
                          <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => void run(item, "restore")}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Restore
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => void downloadAsset(item.id).catch(() => setError("DOWNLOAD_UNAVAILABLE"))}>
                            <Download className="mr-2 h-4 w-4" /> Download
                          </Button>
                        </>
                      ) : null}
                      <Button size="sm" disabled={busyId === item.id} onClick={() => void run(item, "purge")}>
                        <Trash2 className="mr-2 h-4 w-4" /> {pending ? "Retry permanent delete" : "Delete permanently"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
