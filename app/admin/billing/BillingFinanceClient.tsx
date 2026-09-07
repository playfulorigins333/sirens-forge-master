"use client"

import { useCallback, useEffect, useState } from "react"

type FinancialEvent = {
  id: string
  kind: string
  tier: string
  source_type: string
  amount_cents: number
  currency: string
  provider_status: string
  entitlement_effect: string
  provider_created_at: string
  updated_at: string
  evidence_due_at: string | null
  created_at: string
}
type Cursor = { before_created_at: string; before_id: string }
const PAGE_SIZE = 25

export default function BillingFinanceClient() {
  const [events, setEvents] = useState<FinancialEvent[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (next: Cursor | null) => {
    setLoading(true)
    setError("")
    try {
      const query = next ? `?before_created_at=${encodeURIComponent(next.before_created_at)}&before_id=${encodeURIComponent(next.before_id)}` : ""
      const response = await fetch(`/api/admin/billing/financial-events${query}`, { cache: "no-store" })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.code || "BILLING_READ_UNAVAILABLE")
      const page = (body.events as FinancialEvent[]).slice(0, PAGE_SIZE)
      setEvents((current) => {
        const merged = next ? [...current, ...page] : page
        return [...new Map(merged.map((event) => [event.id, event])).values()]
      })
      setHasMore(body.has_more === true)
      setCursor(body.next_cursor || null)
    } catch {
      setError("Financial events are unavailable.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(null) }, [load])

  return <main className="mx-auto max-w-6xl p-8 text-white">
    <h1 className="text-3xl font-bold">Billing financial events</h1>
    <p className="mt-2 text-gray-400">Read-only refund, dispute, and finance-review evidence.</p>
    {error ? <p className="mt-6 text-rose-300">{error}</p> : <div className="mt-8 overflow-x-auto">
      <table className="w-full text-left text-sm"><thead><tr>{["Kind", "Tier / source", "Amount", "Status", "Entitlement effect", "Provider time", "Evidence due"].map((label) => <th className="border-b border-white/20 p-3" key={label}>{label}</th>)}</tr></thead>
        <tbody>{events.map((event) => <tr key={event.id}><td className="p-3">{event.kind}</td><td className="p-3">{event.tier} · {event.source_type}</td><td className="p-3">{(event.amount_cents / 100).toFixed(2)} {event.currency.toUpperCase()}</td><td className="p-3">{event.provider_status}</td><td className="p-3">{event.entitlement_effect}</td><td className="p-3">{new Date(event.provider_created_at).toLocaleString()}</td><td className="p-3">{event.evidence_due_at ? new Date(event.evidence_due_at).toLocaleString() : "—"}</td></tr>)}</tbody>
      </table>
      {hasMore && cursor ? <button disabled={loading} onClick={() => void load(cursor)} className="mt-6 rounded-xl border border-white/20 px-4 py-2 disabled:opacity-50">{loading ? "Loading…" : "Load older"}</button> : null}
      {!events.length && !loading ? <p className="mt-6 text-gray-400">No financial events found.</p> : null}
    </div>}
  </main>
}
