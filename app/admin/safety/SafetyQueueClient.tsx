"use client";
import { FormEvent, useEffect, useState } from "react";

type Item = {
  id: string; case_reference: string; category: string; severity: string;
  current_state: string; updated_at: string; safe_summary: string;
};
type Activity = {
  sequence_no: number; actor_kind: string; activity_type: string;
  from_state: string | null; to_state: string | null; reason_code: string | null;
  reason: string | null; safe_reference: string | null; outcome_summary: string | null;
  created_at: string;
};

const QUEUE_PAGE_SIZE = 25;
const QUEUE_FETCH_SIZE = 26;
const HISTORY_PAGE_SIZE = 50;
const HISTORY_FETCH_SIZE = 51;
const NEXT_STATES: Record<string, string[]> = {
  RECEIVED: ["TRIAGED"],
  TRIAGED: ["INFORMATION_NEEDED", "UNDER_REVIEW", "ESCALATED"],
  INFORMATION_NEEDED: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["ESCALATED", "ACTION_PENDING", "NOTIFIED"],
  ESCALATED: ["UNDER_REVIEW", "ACTION_PENDING"],
  ACTION_PENDING: ["ACTIONED", "UNDER_REVIEW"],
  ACTIONED: ["NOTIFIED"],
  NOTIFIED: ["CLOSED"],
  CLOSED: ["APPEAL_OR_COUNTERNOTICE"],
  APPEAL_OR_COUNTERNOTICE: ["UNDER_REVIEW", "CLOSED"],
};
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
const uniqueBy = <T,>(rows: T[], key: (row: T) => string | number) => [...new Map(rows.map((row) => [key(row), row])).values()];

export default function SafetyQueueClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextState, setNextState] = useState("");
  const [hasMoreCases, setHasMoreCases] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");

  async function loadCases(reset = false) {
    setLoadingCases(true);
    const current = reset ? [] : items;
    const lastDisplayed = current.at(-1);
    const parameters = new URLSearchParams({ limit: String(QUEUE_FETCH_SIZE) });
    if (lastDisplayed) {
      parameters.set("before", lastDisplayed.updated_at);
      parameters.set("before_id", lastDisplayed.id);
    }
    const response = await fetch(`/api/admin/safety/cases?${parameters}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      if (body.actionPath) location.assign(`${body.actionPath}?next=${encodeURIComponent("/admin/safety")}`);
      else setError("Safety queue unavailable.");
    } else {
      const page = body.cases as Item[];
      const visible = page.slice(0, QUEUE_PAGE_SIZE);
      setItems(uniqueBy([...current, ...visible], (item) => item.id));
      setHasMoreCases(visible.length > 0 && page.length > QUEUE_PAGE_SIZE);
    }
    setLoadingCases(false);
  }

  useEffect(() => { void loadCases(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(reference: string) {
    setError("");
    setActivities([]);
    setHasMoreHistory(false);
    setLoadingHistory(true);
    const [caseResponse, activityResponse] = await Promise.all([
      fetch(`/api/admin/safety/cases/${reference}`, { cache: "no-store" }),
      fetch(`/api/admin/safety/cases/${reference}/activities?limit=${HISTORY_FETCH_SIZE}`, { cache: "no-store" }),
    ]);
    const caseBody = await caseResponse.json();
    const activityBody = await activityResponse.json();
    if (caseResponse.ok && activityResponse.ok) {
      const page = activityBody.activities as Activity[];
      setSelected(caseBody.case);
      setActivities(page.slice(0, HISTORY_PAGE_SIZE));
      setHasMoreHistory(page.length > HISTORY_PAGE_SIZE);
      setNextState(NEXT_STATES[caseBody.case.state]?.[0] ?? "");
    } else setError("Case detail or chronology is unavailable.");
    setLoadingHistory(false);
  }

  async function loadOlderHistory() {
    if (!selected || loadingHistory) return;
    setLoadingHistory(true);
    const lastDisplayed = activities.at(-1);
    const parameters = new URLSearchParams({ limit: String(HISTORY_FETCH_SIZE) });
    if (lastDisplayed) parameters.set("before_sequence", String(lastDisplayed.sequence_no));
    const response = await fetch(`/api/admin/safety/cases/${selected.caseReference}/activities?${parameters}`, { cache: "no-store" });
    const body = await response.json();
    if (response.ok) {
      const page = body.activities as Activity[];
      const visible = page.slice(0, HISTORY_PAGE_SIZE);
      setActivities(uniqueBy([...activities, ...visible], (activity) => activity.sequence_no));
      setHasMoreHistory(visible.length > 0 && page.length > HISTORY_PAGE_SIZE);
    } else setError("Older chronology is unavailable.");
    setLoadingHistory(false);
  }

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const state = String(form.get("state"));
    const response = await fetch(`/api/admin/safety/cases/${selected.caseReference}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, reasonCode: form.get("reasonCode"), reason: form.get("reason"), ...(state === "CLOSED" ? { outcomeSummary: form.get("outcomeSummary") } : {}) }),
    });
    if (response.ok) {
      await loadCases(true);
      await open(selected.caseReference);
    } else {
      const body = await response.json();
      setError(body.code === "SAFETY_UNAVAILABLE" ? "Safety service unavailable. No transition was recorded." : body.code === "SAFETY_NOT_FOUND" ? "Case no longer exists." : "Transition rejected by the controlled state graph.");
    }
  }

  return <main className="mx-auto max-w-6xl p-6">
    <h1 className="text-3xl font-semibold">Trust &amp; safety cases</h1>
    <p className="mt-2 text-zinc-400">Minimum necessary case data. Never browse or duplicate private media. This workflow records decisions only; it performs no removal, account action, or external report.</p>
    <p className="text-red-400" role="alert">{error}</p>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div><ul className="space-y-3">{items.map((item) => <li key={item.id} className="rounded border border-zinc-800 p-4"><button className="w-full text-left" onClick={() => void open(item.case_reference)}><strong>{item.case_reference} · {item.severity}</strong><span className="float-right">{label(item.current_state)}</span><p>{label(item.category)}</p><p className="mt-2 text-sm text-zinc-400">{item.safe_summary}</p></button></li>)}</ul>{hasMoreCases && <button className="mt-4 rounded border border-zinc-700 px-4 py-2" disabled={loadingCases} onClick={() => void loadCases()}>{loadingCases ? "Loading…" : "Load older cases"}</button>}</div>
      {selected && <section className="rounded border border-zinc-700 p-5">
        <h2 className="text-xl font-semibold">{selected.caseReference}</h2>
        <dl className="mt-3 space-y-2 text-sm"><dt>Category / severity / state</dt><dd>{label(selected.category)} · {selected.severity} · {label(selected.state)}</dd><dt>Reporter relationship</dt><dd>{label(selected.reporterType)}</dd><dt>Affected reference</dt><dd>{selected.affectedReference || "Not supplied"}</dd><dt>URL</dt><dd className="break-all">{selected.contentUrl || "Not supplied"}</dd><dt>Description</dt><dd className="whitespace-pre-wrap">{selected.description}</dd><dt>Requested action</dt><dd>{selected.requestedAction || "Not supplied"}</dd></dl>
        <div className="mt-6 flex items-baseline justify-between"><h3 className="font-semibold">Chronology</h3><span className="text-xs text-zinc-500">Newest first</span></div>
        <ol className="mt-2 space-y-2 text-sm">{activities.map((activity) => <li key={activity.sequence_no} className="rounded bg-zinc-900 p-3"><strong>#{activity.sequence_no} · {label(activity.activity_type)}</strong><p>{activity.from_state ? `${label(activity.from_state)} → ` : ""}{activity.to_state ? label(activity.to_state) : ""} · {label(activity.actor_kind)}</p>{activity.reason && <p>{activity.reason_code ? `${label(activity.reason_code)}: ` : ""}{activity.reason}</p>}{activity.outcome_summary && <p>Closure outcome: {activity.outcome_summary}</p>}<time className="text-zinc-500">{new Date(activity.created_at).toLocaleString()}</time></li>)}</ol>
        {hasMoreHistory && <button className="mt-3 rounded border border-zinc-700 px-4 py-2" disabled={loadingHistory} onClick={() => void loadOlderHistory()}>{loadingHistory ? "Loading…" : "Load older history"}</button>}
        {(NEXT_STATES[selected.state]?.length ?? 0) > 0 && <form className="mt-5 space-y-3" onSubmit={transition}><label className="block">Next state<select required name="state" value={nextState} onChange={(event) => setNextState(event.target.value)} className="mt-1 w-full rounded bg-zinc-900 p-2">{NEXT_STATES[selected.state].map((state) => <option value={state} key={state}>{label(state)}{state === "ACTIONED" ? " — record separately authorized action" : ""}</option>)}</select></label><label className="block">Reason code<select required name="reasonCode" className="mt-1 w-full rounded bg-zinc-900 p-2">{["SAFETY", "UNDERAGE_REPORT", "NONCONSENSUAL", "LIKENESS", "PRIVACY", "COPYRIGHT_DMCA", "PLATFORM_POLICY", "ACCOUNT_APPEAL", "LEGAL_PROCESS", "INSUFFICIENT_INFORMATION"].map((code) => <option value={code} key={code}>{label(code)}</option>)}</select></label><label className="block">Factual transition reason<textarea required minLength={3} maxLength={1000} name="reason" className="mt-1 min-h-24 w-full rounded bg-zinc-900 p-2" /></label>{nextState === "CLOSED" && <label className="block">Required safe closure outcome<textarea required minLength={3} maxLength={1000} name="outcomeSummary" className="mt-1 min-h-20 w-full rounded bg-zinc-900 p-2" /></label>}<button className="rounded bg-fuchsia-700 px-4 py-2">Record transition</button></form>}
      </section>}
    </div>
  </main>;
}
