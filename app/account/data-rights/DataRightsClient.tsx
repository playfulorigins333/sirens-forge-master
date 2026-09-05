"use client";

import { useMemo, useState } from "react";

type ExportRow = {
  id: string;
  status: string;
  requestedAt: string;
  processingStartedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  downloadedAt?: string | null;
  expiresAt?: string | null;
  sizeBytes?: number | null;
  errorCode?: string | null;
};

type DeletionState = {
  accountLifecycleState: string;
  accountLifecycleUpdatedAt: string;
  protectedAccount: boolean;
  request: null | {
    id: string;
    status: string;
    exportChoice: string;
    exportJobId: string | null;
    requestedAt: string;
    recoveryDeadline: string;
    reactivatedAt: string | null;
  };
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || "REQUEST_FAILED"));
  return body;
}

export default function DataRightsClient({ initialExports, initialDeletion }: { initialExports: ExportRow[]; initialDeletion: DeletionState }) {
  const [exports, setExports] = useState(initialExports);
  const [deletion, setDeletion] = useState(initialDeletion);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [exportChoice, setExportChoice] = useState<"export_before_deletion" | "skip_export">("export_before_deletion");

  const readyExport = useMemo(() => exports.find((item) => ["completed", "downloaded"].includes(item.status) && item.expiresAt && new Date(item.expiresAt).getTime() > Date.now()) ?? null, [exports]);
  const deletionPending = deletion.accountLifecycleState === "voluntary_deletion_pending" && deletion.request?.status === "pending";

  async function refresh() {
    const [exportBody, deletionBody] = await Promise.all([
      jsonRequest("/api/account/data-export"),
      jsonRequest("/api/account/deletion"),
    ]);
    setExports(exportBody.exports ?? []);
    setDeletion(deletionBody.deletion);
  }

  async function requestExport() {
    setBusy("export"); setMessage("");
    try {
      await jsonRequest("/api/account/data-export", { method: "POST", body: "{}" });
      await refresh();
      setMessage("Export requested. This page will show a download when the background job finishes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "EXPORT_REQUEST_FAILED"); }
    finally { setBusy(null); }
  }

  async function downloadExport(id: string) {
    setBusy(`download:${id}`); setMessage("");
    try {
      const body = await jsonRequest(`/api/account/data-export/${id}/download`);
      if (typeof body.url !== "string") throw new Error("EXPORT_DOWNLOAD_UNAVAILABLE");
      window.location.assign(body.url);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "EXPORT_DOWNLOAD_UNAVAILABLE"); }
    finally { setBusy(null); }
  }

  async function requestDeletion() {
    setBusy("delete"); setMessage("");
    try {
      await jsonRequest("/api/account/deletion/request", {
        method: "POST",
        body: JSON.stringify({
          export_choice: exportChoice,
          export_job_id: exportChoice === "export_before_deletion" ? readyExport?.id ?? null : null,
          confirmation_phrase: confirmation,
        }),
      });
      setConfirmation("");
      await refresh();
      setMessage("Account deletion requested. Normal product use is now frozen during the 60-day recovery period.");
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACCOUNT_DELETION_FAILED";
      setMessage(code === "ACCOUNT_DELETION_BILLING_ACTIVE" ? "Cancel the renewable subscription in Billing first. Then return here to request deletion." : code);
    } finally { setBusy(null); }
  }

  async function reactivate() {
    setBusy("reactivate"); setMessage("");
    try {
      await jsonRequest("/api/account/deletion/reactivate", { method: "POST", body: "{}" });
      await refresh();
      setMessage("Account reactivated. Normal product access is restored, subject to your current subscription and policy status.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ACCOUNT_REACTIVATION_FAILED"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-8">
      {message ? <div className="rounded-2xl border border-cyan-400/20 bg-cyan-950/20 px-5 py-4 text-sm text-cyan-100">{message}</div> : null}

      {deletionPending ? (
        <section className="rounded-[28px] border border-amber-400/30 bg-amber-950/20 p-7">
          <h2 className="text-2xl font-bold text-amber-200">Account deletion pending</h2>
          <p className="mt-3 text-sm text-gray-300">Normal product use is frozen. Your recovery deadline is <strong>{formatDate(deletion.request?.recoveryDeadline)}</strong>. Reactivating before that deadline cancels this deletion request.</p>
          <p className="mt-3 text-xs text-gray-400">Automatic day-60 irreversible purge, legal-hold handling, and warning delivery are enforced by the later retention/notification phases; this screen does not claim they are active yet.</p>
          <button disabled={busy !== null} onClick={reactivate} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{busy === "reactivate" ? "Reactivating…" : "Reactivate account"}</button>
        </section>
      ) : null}

      <section className="rounded-[28px] border border-white/10 bg-white/5 p-7">
        <h2 className="text-2xl font-bold">Export your data</h2>
        <p className="mt-3 text-sm leading-6 text-gray-300">Creates a private ZIP in the background with creator-owned account, project, conversation, upload, and media data. Trained LoRA/model artifacts and proprietary provider, trainer, moderation, Vault, seed, and infrastructure metadata are excluded.</p>
        <button disabled={busy !== null} onClick={requestExport} className="mt-5 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{busy === "export" ? "Requesting…" : "Request data export"}</button>
        <div className="mt-6 space-y-3">
          {exports.length === 0 ? <p className="text-sm text-gray-500">No exports requested yet.</p> : exports.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="font-semibold">{item.status.replace(/_/g, " ")}</span><span className="text-gray-500">{formatDate(item.requestedAt)}</span></div>
              {item.sizeBytes ? <div className="mt-2 text-gray-400">{formatBytes(item.sizeBytes)}</div> : null}
              {item.expiresAt ? <div className="mt-1 text-gray-400">Available until {formatDate(item.expiresAt)}</div> : null}
              {item.errorCode ? <div className="mt-1 text-rose-300">{item.errorCode}</div> : null}
              {["completed", "downloaded"].includes(item.status) && item.expiresAt && new Date(item.expiresAt).getTime() > Date.now() ? (
                <button disabled={busy !== null} onClick={() => downloadExport(item.id)} className="mt-3 rounded-lg border border-white/20 px-4 py-2 font-semibold hover:bg-white/10 disabled:opacity-50">Download private ZIP</button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-rose-400/20 bg-rose-950/10 p-7">
        <h2 className="text-2xl font-bold text-rose-200">Delete your account</h2>
        {deletion.protectedAccount ? (
          <p className="mt-3 text-sm text-gray-300">This protected Production account cannot enter voluntary deletion through the creator controls.</p>
        ) : deletionPending ? (
          <p className="mt-3 text-sm text-gray-300">A deletion request is already active. Use the reactivation control above if you want to keep the account.</p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-gray-300">Deletion has a 60-day recovery period. Normal product use freezes immediately. Existing renewable subscriptions must already be set to cancel before the deletion request can start.</p>
            <div className="mt-5 space-y-3 text-sm">
              <label className="flex items-start gap-3"><input type="radio" checked={exportChoice === "export_before_deletion"} onChange={() => setExportChoice("export_before_deletion")} /><span><strong>Export before deletion</strong><br /><span className="text-gray-400">Requires a completed, unexpired export first.</span></span></label>
              <label className="flex items-start gap-3"><input type="radio" checked={exportChoice === "skip_export"} onChange={() => setExportChoice("skip_export")} /><span><strong>Skip export</strong><br /><span className="text-gray-400">Proceed without creating a copy of your data.</span></span></label>
            </div>
            {exportChoice === "export_before_deletion" && !readyExport ? <p className="mt-4 text-sm text-amber-300">Request an export above and wait until it is ready before continuing.</p> : null}
            <label className="mt-5 block text-sm text-gray-300">Type <strong>DELETE MY ACCOUNT</strong> to confirm.</label>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white outline-none focus:border-rose-400" />
            <button disabled={busy !== null || confirmation !== "DELETE MY ACCOUNT" || (exportChoice === "export_before_deletion" && !readyExport)} onClick={requestDeletion} className="mt-4 rounded-xl bg-rose-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{busy === "delete" ? "Requesting…" : "Start 60-day account deletion"}</button>
          </>
        )}
      </section>
    </div>
  );
}
