import Link from "next/link"

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-white">
            Sirens Forge
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-white/60">
            Identity-first AI generation for images, video, and guided creative workflows.
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-white/70"
        >
          <Link
            href="/terms"
            className="transition hover:text-white"
          >
            Terms
          </Link>

          <Link
            href="/privacy"
            className="transition hover:text-white"
          >
            Privacy
          </Link>

          <Link
            href="/acceptable-use"
            className="transition hover:text-white"
          >
            Acceptable Use
          </Link>

          <a
            href="mailto:admin@sirensforge.com"
            className="transition hover:text-white"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  )
}