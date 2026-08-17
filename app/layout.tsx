import "./globals.css"
import "./reduced-motion.css"
import type { ReactNode } from "react"
import type { Metadata } from "next"
import Footer from "@/components/layout/Footer"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.sirensforge.vip"
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Sirens Forge", template: "%s | Sirens Forge" },
  description: "Create identity-consistent AI media and manage your creator workflow with Sirens Forge.",
  openGraph: { type: "website", siteName: "Sirens Forge", title: "Sirens Forge", description: "Identity-first AI media for creators." },
  twitter: { card: "summary", title: "Sirens Forge", description: "Identity-first AI media for creators." },
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="min-h-screen bg-black text-white">
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  )
}
