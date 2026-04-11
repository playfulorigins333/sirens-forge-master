import React from "react";
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";

export const metadata = {
  title: "Sirens Forge — Siren's Mind",
};

export default async function SirensMindLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  return <>{children}</>;
}