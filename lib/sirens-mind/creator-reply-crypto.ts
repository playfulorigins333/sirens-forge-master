import "server-only"
import crypto from "node:crypto"

const PREFIX = "v1"
function key(env: NodeJS.ProcessEnv) {
  const encoded = env.SIRENS_MIND_CREATOR_REPLY_DATA_ENCRYPTION_KEY
  if (!encoded) throw new Error("CREATOR_REPLY_DATA_KEY_NOT_CONFIGURED")
  const decoded = Buffer.from(encoded, "base64")
  if (decoded.length !== 32) throw new Error("CREATOR_REPLY_DATA_KEY_INVALID")
  return decoded
}
export function creatorReplyDataKeyVersion(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.SIRENS_MIND_CREATOR_REPLY_DATA_KEY_VERSION)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("CREATOR_REPLY_DATA_KEY_VERSION_INVALID")
  return value
}
export function encryptCreatorReplyData(plaintext: string, aad: string, env: NodeJS.ProcessEnv = process.env) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key(env), iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":")
}
export function decryptCreatorReplyData(envelope: string, aad: string, env: NodeJS.ProcessEnv = process.env) {
  const parts = envelope.split(":")
  if (parts.length !== 4 || parts[0] !== PREFIX || !parts.slice(1).every(Boolean)) throw new Error("CREATOR_REPLY_DATA_ENVELOPE_INVALID")
  const iv = Buffer.from(parts[1], "base64url"), tag = Buffer.from(parts[2], "base64url"), ciphertext = Buffer.from(parts[3], "base64url")
  if (iv.length !== 12 || tag.length !== 16) throw new Error("CREATOR_REPLY_DATA_ENVELOPE_INVALID")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(env), iv)
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
export function assertCreatorReplyKeyVersion(storedVersion: number, env: NodeJS.ProcessEnv = process.env) {
  if (storedVersion !== creatorReplyDataKeyVersion(env)) throw new Error("CREATOR_REPLY_DATA_KEY_VERSION_UNSUPPORTED")
}
export const subscriberNotesAad = (workspaceId: string, subscriberId: string) => `creator-reply:subscriber-notes:${workspaceId}:${subscriberId}`
export const conversationCheckpointAad = (workspaceId: string, conversationId: string) => `creator-reply:conversation-checkpoint:${workspaceId}:${conversationId}`
