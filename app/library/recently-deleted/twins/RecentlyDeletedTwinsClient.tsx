"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type DeletedTwin = {
  id: string;
  name: string;
  status: string;
  lifecycleState: "trashed" | "purge_pending";
  trainingDataState: "active" | "purge_pending" | "purged";
  trashedAt: string | null;
  purgeAfter: string | null;
};

async function post(twinId: string, action: "restore" | "purge") {
  const response = await fetch(`/api/library/twins/${encodeURIComponent(twinId)}/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "LIFECYCLE_UNAVAILABLE");
}

function date(value: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function RecentlyDeletedTwinsClient({ items }: { items: DeletedTwin[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (item: DeletedTwin, action: "restore" | "purge") => {
    if (action === "purge" && !window.confirm("Permanently delete this AI Twin now? The trained Twin and remaining training data will be removed. Existing media already generated with it will remain. This cannot be undone.")) return;
    setBusyId(item.id); setError(null);
    try { await post(item.id, action); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "LIFECYCLE_UNAVAILABLE"); setBusyId(null); }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-sm uppercase tracking-[0.2em] text-purple-300">Private Library</p>
          <h1 className="mt-2 text-3xl font-bold">Recently Deleted AI Twins</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-300">Twins remain recoverable for 30 days unless you permanently delete them sooner. Existing generated media is not deleted with the Twin. Automatic day-30 enforcement remains a Phase 8 scheduler responsibility.</p>
          <div className="mt-4 flex gap-4 text-sm"><Link className="text-purple-200 underline" href="/library/recently-deleted">Recently Deleted media</Link><Link className="text-purple-200 underline" href="/library/manage/twins">Manage active Twins</Link></div>
        </header>
        {error ? <div className="rounded-xl border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</div> : null}
        {items.length === 0 ? <div className="rounded-2xl border border-gray-800 bg-gray-950 p-8 text-center text-gray-400">No AI Twins are in Recently Deleted.</div> : (
          <div className="space-y-4">{items.map((item) => {
            const pending = item.lifecycleState === "purge_pending";
            return <article key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-xs text-gray-400">Deleted: {date(item.trashedAt)}</p><p className="mt-1 text-xs text-gray-400">{pending ? "Permanent deletion pending" : `Purge eligible after: ${date(item.purgeAfter)}`}</p><p className="mt-2 text-xs text-gray-500">Training data: {item.trainingDataState} · Twin status: {item.status}</p></div>
                <div className="flex flex-wrap gap-2">
                  {!pending ? <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => void run(item,"restore")}><RotateCcw className="mr-2 h-4 w-4" /> Restore Twin</Button> : null}
                  <Button size="sm" disabled={busyId === item.id} onClick={() => void run(item,"purge")}><Trash2 className="mr-2 h-4 w-4" /> {pending ? "Retry permanent delete" : "Delete permanently"}</Button>
                </div>
              </div>
            </article>;
          })}</div>
        )}
      </div>
    </main>
  );
}
