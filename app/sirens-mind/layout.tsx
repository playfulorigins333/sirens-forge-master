import React from "react";
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";

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
    } else if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") {
      redirect(policyConsentPath("/sirens-mind"));
    } else {
      redirect("/pricing");
    }
  }

  return <>{children}</>;
}