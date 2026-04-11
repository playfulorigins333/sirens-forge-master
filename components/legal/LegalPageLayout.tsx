"use client"

import React from "react"

type LegalPageLayoutProps = {
  title: string
  lastUpdated?: string
  children: React.ReactNode
}

export default function LegalPageLayout({
  title,
  lastUpdated,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 py-16">
        
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            {title}
          </h1>

          {lastUpdated && (
            <p className="text-sm text-gray-400">
              Last updated: {lastUpdated}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="space-y-8 text-gray-200 leading-relaxed">
          {children}
        </div>

        {/* Divider */}
        <div className="my-12 border-t border-gray-800" />

        {/* Footer */}
        <div className="text-sm text-gray-400 space-y-2">
          <p>
            If you have any questions about this policy, please contact us at:
          </p>
          <p className="text-white">
            admin@sirensforge.com
          </p>
        </div>
      </div>
    </div>
  )
}