import Link from "next/link";

export default async function AgeGate({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=(await searchParams).next || "/";
  return <main className="min-h-screen bg-black text-white flex items-center justify-center p-6 text-center">
    <div className="max-w-2xl rounded-2xl border border-red-900 bg-zinc-950 p-8 shadow-2xl">
      <div className="text-6xl" aria-hidden>⚠</div>
      <h1 className="mt-4 text-5xl font-bold text-red-500">18+ ONLY</h1>
      <p className="mt-6 text-xl">Sirens Forge is an adult-only service and may contain adult AI-generated content.</p>
      <p className="mt-3 text-zinc-400">By continuing, you attest that you are at least 18 years old and may lawfully access adult content where you live.</p>
      <p className="mt-3 text-sm text-zinc-500">This is a self-attestation, not identity or government-ID age verification. We store an HttpOnly cookie to remember it.</p>
      <form action="/api/age-attestation" method="post" className="mt-8">
        <input type="hidden" name="attest" value="18plus"/>
        <input type="hidden" name="next" value={next}/>
        <button className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-4 font-bold" type="submit">I am 18 or older — continue</button>
      </form>
      <a className="mt-5 block text-zinc-400 underline" href="https://www.google.com">I am under 18 — exit</a>
      <p className="mt-8 text-sm text-zinc-400">Safety and legal reporting remains available without attesting: <Link className="underline" href="/underage-policy">underage safety</Link>, <Link className="underline" href="/report-intimate-content">intimate-content removal</Link>, or <Link className="underline" href="/complaints">complaints</Link>.</p>
    </div>
  </main>;
}
