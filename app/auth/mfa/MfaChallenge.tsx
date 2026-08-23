"use client"
import { useState } from "react"
import { supabaseBrowser } from "@/lib/supabase"

export default function MfaChallenge({ factors, next }: { factors: { id: string; friendlyName: string }[]; next: string }) {
  const [factorId, setFactorId] = useState(factors[0].id)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("")
    const owned = factors.some((factor) => factor.id === factorId)
    const result = owned ? await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId, code: code.trim() }) : { error: true }
    if (result.error) { setError("The verification code was not accepted."); setBusy(false); return }
    window.location.replace(next)
  }
  return <main className="min-h-screen bg-gray-950 text-white p-6 flex items-center justify-center"><form onSubmit={verify} className="w-full max-w-md space-y-4 rounded-xl border border-gray-700 bg-gray-900 p-6">
    <h1 className="text-2xl font-semibold">Two-factor verification</h1><p className="text-gray-300">Enter a current code from your authenticator app.</p>
    <label className="block">Authenticator<select className="mt-1 w-full bg-gray-800 p-2" value={factorId} onChange={(e) => setFactorId(e.target.value)}>{factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendlyName}</option>)}</select></label>
    <label className="block">Six-digit code<input inputMode="numeric" autoComplete="one-time-code" className="mt-1 w-full bg-gray-800 p-2" value={code} onChange={(e) => setCode(e.target.value)} /></label>
    {error && <p role="alert" className="text-rose-300">{error}</p>}<button disabled={busy || !/^\d{6}$/.test(code.trim())} className="rounded bg-cyan-600 px-4 py-2 disabled:opacity-50">Verify</button>
  </form></main>
}
