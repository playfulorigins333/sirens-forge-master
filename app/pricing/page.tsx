import { Suspense } from "react";
import PricingClient from "./PricingClient";

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <PricingClient />
    </Suspense>
  );
}
