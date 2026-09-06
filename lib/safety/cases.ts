import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { classifySafetyRpcError } from "@/lib/safety/contracts";
export * from "@/lib/safety/contracts";

export type SafetyLookup<T> = { kind: "found"; value: T } | { kind: "not_found" } | { kind: "unavailable" };
export type SafetyMutation = { kind: "updated" } | { kind: "not_found" } | { kind: "invalid_transition" } | { kind: "unavailable" };

export async function createPublicSafetyCase(input: Record<string, unknown>) {
  const { data, error } = await getSupabaseAdmin().rpc("create_public_safety_case", {
    p_category: input.category, p_reporter_type: input.reporterType,
    p_contact_email: input.contactEmail ?? null, p_affected_reference: input.affectedReference ?? null,
    p_content_url: input.contentUrl ?? null, p_description: input.description,
    p_requested_action: input.requestedAction ?? null,
    p_affected_person_declaration: input.affectedPersonDeclaration ?? null,
    p_good_faith: input.goodFaith === true,
  });
  return error || typeof data !== "string" ? null : data;
}

export async function listSafetyCases(actorUserId: string, state: string | null, before: string | null, beforeId: string | null, limit: number) {
  const { data, error } = await getSupabaseAdmin().rpc("list_admin_safety_cases", {
    p_actor_user_id: actorUserId, p_state: state, p_before: before, p_before_id: beforeId, p_limit: limit,
  });
  return error ? null : data;
}

export async function getSafetyCase(actorUserId: string, caseRef: string): Promise<SafetyLookup<unknown>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_admin_safety_case", { p_actor_user_id: actorUserId, p_case_ref: caseRef });
  if (error) return { kind: classifySafetyRpcError(error.message) === "not_found" ? "not_found" : "unavailable" };
  return data ? { kind: "found", value: data } : { kind: "not_found" };
}

export async function listSafetyActivities(actorUserId: string, caseRef: string, beforeSequence: number | null, limit: number): Promise<SafetyLookup<unknown>> {
  const { data, error } = await getSupabaseAdmin().rpc("list_admin_safety_case_activities", {
    p_actor_user_id: actorUserId, p_case_ref: caseRef, p_before_sequence: beforeSequence, p_limit: limit,
  });
  if (error) return { kind: classifySafetyRpcError(error.message) === "not_found" ? "not_found" : "unavailable" };
  return { kind: "found", value: data ?? [] };
}

export async function transitionSafetyCase(actorUserId: string, caseRef: string, toState: string, reasonCode: string, reason: string, outcome: string | null): Promise<SafetyMutation> {
  const { error } = await getSupabaseAdmin().rpc("transition_admin_safety_case", {
    p_actor_user_id: actorUserId, p_case_ref: caseRef, p_to_state: toState,
    p_reason_code: reasonCode, p_reason: reason, p_outcome_summary: outcome,
  });
  if (!error) return { kind: "updated" };
  const kind = classifySafetyRpcError(error.message);
  return { kind };
}
