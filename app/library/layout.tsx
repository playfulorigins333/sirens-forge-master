import Link from "next/link";

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="border-b border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 md:px-6">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4">
          <Link className="font-semibold text-purple-200 hover:text-white" href="/library">Creation Loop</Link>
          <Link className="text-gray-300 hover:text-white" href="/library/recently-deleted">Recently Deleted</Link>
        </div>
      </nav>
      {children}
    </>
  );
}
