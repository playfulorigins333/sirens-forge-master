import Link from "next/link";
import type { ReactNode } from "react";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="fixed right-4 top-20 z-50 sm:right-8">
        <nav aria-label="Account data controls" className="rounded-2xl border border-white/15 bg-black/85 px-3 py-2 text-xs font-semibold text-gray-200 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Link href="/account" className="transition hover:text-cyan-300">Account</Link>
            <span aria-hidden="true" className="text-gray-600">•</span>
            <Link href="/account/data-rights" className="transition hover:text-cyan-300">Privacy & data controls</Link>
          </div>
        </nav>
      </div>
      {children}
    </>
  );
}
