"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full mt-20 border-t border-white/10 bg-black/40 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-10 text-sm text-gray-300">

        {/* Top Section */}
        <div className="flex flex-col md:flex-row justify-between gap-10 text-center md:text-left">

          {/* Brand */}
          <div className="max-w-md">
            <div className="font-semibold text-white mb-2 text-lg">
              Sirens Forge
            </div>
            <p className="text-gray-400">
              The next evolution of AI generation for images, video, and
              creator-driven workflows.
            </p>
          </div>

          {/* Link Columns */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8">

            {/* Core */}
            <div className="flex flex-col gap-2">
              <span className="text-white font-medium">Core</span>
              <Link href="/terms" className="hover:text-cyan-400 transition">Terms</Link>
              <Link href="/privacy" className="hover:text-cyan-400 transition">Privacy</Link>
              <Link href="/acceptable-use" className="hover:text-cyan-400 transition">Acceptable Use</Link>
              <Link href="/community-guidelines" className="hover:text-cyan-400 transition">Guidelines</Link>
              <Link href="/faq" className="hover:text-cyan-400 transition">FAQ</Link>
            </div>

            {/* Safety */}
            <div className="flex flex-col gap-2">
              <span className="text-white font-medium">Safety</span>
              <Link href="/underage-policy" className="hover:text-cyan-400 transition">Underage Policy</Link>
              <Link href="/blocked-content" className="hover:text-cyan-400 transition">Blocked Content</Link>
              <Link href="/content-removal" className="hover:text-cyan-400 transition">Content Removal</Link>
              <Link href="/complaints" className="hover:text-cyan-400 transition">Complaints</Link>
            </div>

            {/* Legal */}
            <div className="flex flex-col gap-2">
              <span className="text-white font-medium">Legal</span>
              <Link href="/dmca" className="hover:text-cyan-400 transition">DMCA</Link>
              <Link href="/2257-exemption" className="hover:text-cyan-400 transition">2257 Statement</Link>
              <Link href="/affiliate-terms" className="hover:text-cyan-400 transition">Affiliate Terms</Link>
              <Link href="/contact" className="hover:text-cyan-400 transition">Contact</Link>
            </div>

          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-t border-white/10 pt-6 text-xs text-gray-400">
          <p>© {new Date().getFullYear()} Sirens Forge. All rights reserved.</p>

          <a
            href="mailto:admin@sirensforge.com"
            className="hover:text-cyan-400 transition"
          >
            admin@sirensforge.com
          </a>
        </div>

      </div>
    </footer>
  );
}