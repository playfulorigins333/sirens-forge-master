import { redirect } from "next/navigation";
import { requireAdminCapability } from "@/lib/security/adminAuthorization";
import SafetyQueueClient from "./SafetyQueueClient";

export const dynamic = "force-dynamic";
export default async function Page() {
  const authorization = await requireAdminCapability("safety.case.read");
  if (authorization.ok === false) redirect(authorization.actionPath ? `${authorization.actionPath}?next=${encodeURIComponent("/admin/safety")}` : "/dashboard");
  return <SafetyQueueClient />;
}
