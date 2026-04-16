"use client"

import { Button } from "@/components/ui/button"

export default function LogoutButton() {
  const handleLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/"
    } catch (err) {
      console.error("Logout failed", err)
    }
  }

  return (
    <Button
      onClick={handleLogout}
      variant="outline"
      className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
    >
      Logout
    </Button>
  )
}