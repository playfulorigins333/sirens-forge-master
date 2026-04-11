import "./globals.css"
import type { ReactNode } from "react"
import Footer from "@/components/layout/Footer"

export const metadata = {
  title: "Sirens Forge",
  description: "Forge Your Muse. Rule Your Empire.",
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
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  )
}