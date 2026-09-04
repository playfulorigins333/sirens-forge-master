import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  assertCreatorReplyKeyVersion,
  conversationCheckpointAad,
  decryptCreatorReplyData,
  subscriberNotesAad,
} from "./creator-reply-crypto";
import { parseCreatorReplyCheckpoint } from "./creator-reply-checkpoint";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class CreatorReplyExportError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

function requireUuid(value: string, code: string) {
  if (!UUID_RE.test(value)) throw new CreatorReplyExportError(code, 400);
}

export async function exportCreatorReplyForProcessingJob(exportId: string, authUserId: string) {
  requireUuid(exportId, "EXPORT_ID_INVALID");
  requireUuid(authUserId, "EXPORT_OWNER_INVALID");

  const db = getSupabaseAdmin();
  const { data: exportJob, error: exportError } = await db
    .from("creator_data_exports")
    .select("id,status,auth_user_id")
    .eq("id", exportId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (exportError) throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_UNAVAILABLE", 503);
  if (!exportJob || exportJob.status !== "processing") {
    throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_JOB_NOT_PROCESSING", 409);
  }

  const { data: workspaces, error: workspaceError } = await db
    .from("sirens_mind_creator_reply_workspaces")
    .select("id,display_name,created_at,updated_at")
    .eq("created_by_user_id", authUserId)
    .order("created_at", { ascending: true });
  if (workspaceError) throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_UNAVAILABLE", 503);

  const exportedSubscribers: Array<Record<string, unknown>> = [];
  const exportedConversations: Array<Record<string, unknown>> = [];

  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace.id);
    const { data: subscribers, error: subscriberError } = await db
      .from("sirens_mind_creator_reply_subscribers")
      .select("id,display_name,platform,platform_handle,notes_ciphertext,notes_key_version,last_used_at,archived_at,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (subscriberError) throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_UNAVAILABLE", 503);

    for (const subscriber of subscribers ?? []) {
      let notes = "";
      if (subscriber.notes_ciphertext) {
        assertCreatorReplyKeyVersion(Number(subscriber.notes_key_version));
        notes = decryptCreatorReplyData(
          String(subscriber.notes_ciphertext),
          subscriberNotesAad(workspaceId, String(subscriber.id)),
        );
      }
      exportedSubscribers.push({
        id: subscriber.id,
        workspace_id: workspaceId,
        display_name: subscriber.display_name,
        platform: subscriber.platform,
        platform_handle: subscriber.platform_handle,
        notes,
        last_used_at: subscriber.last_used_at,
        archived_at: subscriber.archived_at,
        created_at: subscriber.created_at,
        updated_at: subscriber.updated_at,
      });
    }

    const { data: conversations, error: conversationError } = await db
      .from("sirens_mind_creator_reply_conversations")
      .select("id,subscriber_id,status,checkpoint_ciphertext,checkpoint_key_version,checkpoint_revision,started_at,last_used_at,archived_at,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (conversationError) throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_UNAVAILABLE", 503);

    for (const conversation of conversations ?? []) {
      assertCreatorReplyKeyVersion(Number(conversation.checkpoint_key_version));
      let checkpoint: unknown = null;
      try {
        checkpoint = parseCreatorReplyCheckpoint(
          JSON.parse(
            decryptCreatorReplyData(
              String(conversation.checkpoint_ciphertext),
              conversationCheckpointAad(workspaceId, String(conversation.id)),
            ),
          ),
        );
      } catch {
        throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_DECRYPT_FAILED", 503);
      }
      if (!checkpoint) throw new CreatorReplyExportError("CREATOR_REPLY_EXPORT_CHECKPOINT_INVALID", 503);
      exportedConversations.push({
        id: conversation.id,
        workspace_id: workspaceId,
        subscriber_id: conversation.subscriber_id,
        status: conversation.status,
        checkpoint_revision: conversation.checkpoint_revision,
        checkpoint,
        started_at: conversation.started_at,
        last_used_at: conversation.last_used_at,
        archived_at: conversation.archived_at,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      });
    }
  }

  return {
    workspaces: workspaces ?? [],
    subscribers: exportedSubscribers,
    conversations: exportedConversations,
  };
}
