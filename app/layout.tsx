import "../styles/globals.css";
import React from "react";

export const metadata = {
  title: "Sirens Forge",
  description: "NSFW/SFW AI Generator — Images, Video, Subscriptions & Muses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white">
        {children}
      </body>
    </html>
  );
}
