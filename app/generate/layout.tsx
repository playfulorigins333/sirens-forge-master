// app/generate/layout.tsx
import React from "react";
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";

export const metadata = {
  title: "Sirens Forge — Generator",
};

export default async function GenerateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hard gate: check subscription before rendering any children
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") {
      redirect(policyConsentPath("/generate"));
    } else {
      redirect("/pricing");
    }
  }

  return <>{children}</>;
}
