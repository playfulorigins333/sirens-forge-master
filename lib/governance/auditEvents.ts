import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function listAuditEvents(args: { actorUserId: string; before: number | null; limit: number; action: string | null; targetType: string | null; actorType: string | null }) {
  const { data, error } = await getSupabaseAdmin().rpc("list_governance_audit_events", {
    p_actor_user_id: args.actorUserId, p_before_sequence: args.before, p_limit: args.limit,
    p_action: args.action, p_target_type: args.targetType, p_actor_type: args.actorType,
  })
  return error ? { ok: false as const } : { ok: true as const, events: data ?? [] }
}
