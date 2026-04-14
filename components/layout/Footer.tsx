"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full mt-20 border-t border-white/10 bg-black/40 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">

        {/* Brand / Description */}
        <div className="text-sm text-gray-300 max-w-md">
          <div className="font-semibold text-white mb-2">
            Sirens Forge
          </div>
          <p className="text-gray-400">
            The next evolution of AI generation for images, video, and
            creator-driven workflows.
          </p>
        </div>

        {/* Links */}
        <div className="flex gap-6 text-sm font-medium">
          <Link
            href="/privacy"
            className="text-gray-300 hover:text-cyan-400 transition"
          >
            Privacy
          </Link>
          <Link
            href="/acceptable-use"
            className="text-gray-300 hover:text-cyan-400 transition"
          >
            Acceptable Use
          </Link>
          <Link
            href="/terms"
            className="text-gray-300 hover:text-cyan-400 transition"
          >
            Terms
          </Link>
          <Link
            href="/faq"
            className="text-gray-300 hover:text-cyan-400 transition"
          >
            FAQ
          </Link>
          <Link
            href="/contact"
            className="text-gray-300 hover:text-cyan-400 transition"
          >
            Contact
          </Link>
        </div>
      </div>
    </footer>
  );
}