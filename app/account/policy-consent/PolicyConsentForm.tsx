"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { MATERIAL_POLICY_MANIFEST } from "@/lib/material-policy/manifest"

export function PolicyConsentForm({ next, alreadyAccepted }: { next: string; alreadyAccepted: boolean }) {
  const router = useRouter()
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [acceptableUse, setAcceptableUse] = useState(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const ready = terms && privacy && acceptableUse && !saving
  if (alreadyAccepted) return <div className="space-y-4"><p className="text-emerald-300">You have accepted the current material policy bundle.</p><Link className="text-cyan-300 underline" href={next}>Continue</Link></div>
  async function submit() {
    if (!ready) return
    setSaving(true); setError("")
    const response = await fetch("/api/account/policy-consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true, materialBundleVersion: MATERIAL_POLICY_MANIFEST.materialBundleVersion }) }).catch(() => null)
    if (!response?.ok) { setError("Your acceptance could not be recorded. Please retry."); setSaving(false); return }
    router.push(next); router.refresh()
  }
  const controls = [
    ["terms", terms, setTerms, "/terms", "Terms of Service"],
    ["privacy", privacy, setPrivacy, "/privacy", "Privacy Policy"],
    ["acceptable-use", acceptableUse, setAcceptableUse, "/acceptable-use", "Acceptable Use Policy"],
  ] as const
  return <div className="space-y-5">
    <p className="text-gray-300">Review each current policy and actively accept all three to continue to creator-product features.</p>
    {controls.map(([id, checked, setter, href, label]) => <label key={id} className="flex items-start gap-3 rounded-xl border border-white/10 p-4">
      <input id={id} type="checkbox" checked={checked} onChange={event => setter(event.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400" />
      <span>I have read and agree to the <Link className="text-cyan-300 underline" href={href} target="_blank">{label}</Link>.</span>
    </label>)}
    {error ? <p role="alert" className="text-rose-300">{error}</p> : null}
    <button type="button" disabled={!ready} onClick={submit} className="rounded-xl bg-cyan-500 px-5 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Recording…" : "Accept current policies"}</button>
  </div>
}
