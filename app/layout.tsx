import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Sirens Forge",
  description: "Forge Your Muse. Rule Your Empire.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
