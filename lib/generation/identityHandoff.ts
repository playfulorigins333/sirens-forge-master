export type IncomingIdentityResolution =
  | { status: "not_requested" }
  | { status: "pending"; identityId: string }
  | { status: "resolved"; identityId: string }
  | { status: "unavailable" };

export function resolveIncomingIdentity(
  pendingIdentityId: string | null,
  identitiesLoaded: boolean,
  completedIdentityIds: readonly string[],
): IncomingIdentityResolution {
  if (!pendingIdentityId) return { status: "not_requested" };
  if (!identitiesLoaded) return { status: "pending", identityId: pendingIdentityId };
  if (completedIdentityIds.includes(pendingIdentityId)) {
    return { status: "resolved", identityId: pendingIdentityId };
  }
  return { status: "unavailable" };
}
