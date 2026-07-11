export function autopostSubscriptionGateStatus(error?: string, status?: number){
  if(error === "UNAUTHENTICATED") return 401
  if(error === "NO_PROFILE") return status ?? 403
  if(error === "NO_ACTIVE_SUBSCRIPTION") return status ?? 402
  return 500
}
