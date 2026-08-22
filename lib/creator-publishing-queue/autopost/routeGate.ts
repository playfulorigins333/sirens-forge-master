export function autopostSubscriptionGateStatus(error?: string, status?: number){
  if(error === "UNAUTHENTICATED") return 401
  if(error === "NO_PROFILE") return status ?? 403
  if(error === "NO_ACTIVE_SUBSCRIPTION") return status ?? 402
  if(error === "POLICY_ACCEPTANCE_REQUIRED") return 428
  return 500
}
