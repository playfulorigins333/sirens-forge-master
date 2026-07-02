import path from "node:path"
import { fileURLToPath } from "node:url"
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin"
import { FANVUE_TOKEN_FRESHNESS_BUFFER_MS } from "./fanvueLivePhotoUploadDryRun"

/**
 * FV-40V safe local/admin-only post-reconnect Fanvue token posture preflight.
 *
 * This preflight reads only the stored autopost_accounts posture for one user and
 * prints safe booleans/classifications only. It does not decrypt tokens, refresh
 * tokens, verify identity live, call Fanvue, upload media, create posts, or write
 * Supabase data.
 *
 * Local command shape (admin/local only; do not run against production data in Codex):
 * DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts --user-id <uuid>
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type FanvueTokenFreshness = "fresh" | "near_expiry" | "expired" | "missing" | "invalid"
export type FanvueNativeUploadReadiness = "ready_for_upload_only_gate" | "blocked"

export type FanvuePostReconnectPreflightArgs = {
  userId?: string | null
  platform?: string | null
}

export type FanvuePostReconnectPreflightAccountRow = {
  user_id?: unknown
  platform?: unknown
  connection_status?: unknown
  provider_account_id?: unknown
  provider_username?: unknown
  encrypted_access_token?: unknown
  encrypted_refresh_token?: unknown
  token_expires_at?: unknown
  metadata?: Record<string, unknown> | null
  scopes?: unknown
}

export type FanvuePostReconnectPreflightOutput = {
  ok: boolean
  platform: "fanvue"
  connection_status: string | null
  account_row_present: boolean
  provider_account_id_present: boolean
  provider_username_present: boolean
  encrypted_access_token_present: boolean
  encrypted_refresh_token_present: boolean
  token_expires_at_present: boolean
  token_freshness: FanvueTokenFreshness
  metadata_provider_is_fanvue: boolean
  metadata_identity_fetched: boolean
  scopes_include_read_media: boolean
  scopes_include_write_media: boolean
  scopes_include_write_creator: boolean
  scopes_include_openid: boolean
  scopes_include_offline_access: boolean
  scopes_include_offline: boolean
  native_upload_readiness: FanvueNativeUploadReadiness
  blockers: string[]
}

export type FanvuePostReconnectPreflightDependencies = {
  loadAccount: (userId: string) => Promise<FanvuePostReconnectPreflightAccountRow | null>
  nowMs?: () => number
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function scopeList(scopes: unknown): string[] {
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string").map((scope) => scope.trim()).filter(Boolean)
  if (typeof scopes === "string") return scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
  return []
}

export function parseFanvuePostReconnectPreflightArgs(argv: string[]): FanvuePostReconnectPreflightArgs {
  const args: FanvuePostReconnectPreflightArgs = { platform: "fanvue" }
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    const next = argv[index + 1]
    if (item === "--user-id") { args.userId = next; index++; continue }
    if (item === "--platform") { args.platform = next; index++; continue }
  }
  return args
}

export function classifyFanvueTokenFreshness(tokenExpiresAt: unknown, nowMs: number = Date.now()): FanvueTokenFreshness {
  if (tokenExpiresAt == null || tokenExpiresAt === "") return "missing"
  if (typeof tokenExpiresAt !== "string" && typeof tokenExpiresAt !== "number" && !(tokenExpiresAt instanceof Date)) return "invalid"
  const expiresAtMs = new Date(tokenExpiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return "invalid"
  if (expiresAtMs <= nowMs) return "expired"
  if (expiresAtMs <= nowMs + FANVUE_TOKEN_FRESHNESS_BUFFER_MS) return "near_expiry"
  return "fresh"
}

export async function loadFanvuePostReconnectPreflightAccount(userId: string): Promise<FanvuePostReconnectPreflightAccountRow | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("autopost_accounts")
    .select("user_id, platform, connection_status, provider_account_id, provider_username, encrypted_access_token, encrypted_refresh_token, token_expires_at, metadata, scopes")
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw new Error("FANVUE_PREFLIGHT_ACCOUNT_LOOKUP_FAILED")
  return data as FanvuePostReconnectPreflightAccountRow | null
}

export function buildFanvuePostReconnectPreflightOutput(account: FanvuePostReconnectPreflightAccountRow | null, nowMs: number = Date.now()): FanvuePostReconnectPreflightOutput {
  const scopes = scopeList(account?.scopes)
  const tokenFreshness = classifyFanvueTokenFreshness(account?.token_expires_at, nowMs)
  const output: FanvuePostReconnectPreflightOutput = {
    ok: false,
    platform: "fanvue",
    connection_status: typeof account?.connection_status === "string" ? account.connection_status : null,
    account_row_present: account != null,
    provider_account_id_present: nonEmptyString(account?.provider_account_id),
    provider_username_present: nonEmptyString(account?.provider_username),
    encrypted_access_token_present: nonEmptyString(account?.encrypted_access_token),
    encrypted_refresh_token_present: nonEmptyString(account?.encrypted_refresh_token),
    token_expires_at_present: account?.token_expires_at != null && account.token_expires_at !== "",
    token_freshness: tokenFreshness,
    metadata_provider_is_fanvue: account?.metadata?.provider === "fanvue",
    metadata_identity_fetched: account?.metadata?.identity_fetched === true,
    scopes_include_read_media: scopes.includes("read:media"),
    scopes_include_write_media: scopes.includes("write:media"),
    scopes_include_write_creator: scopes.includes("write:creator"),
    scopes_include_openid: scopes.includes("openid"),
    scopes_include_offline_access: scopes.includes("offline_access"),
    scopes_include_offline: scopes.includes("offline"),
    native_upload_readiness: "blocked",
    blockers: [],
  }

  if (!output.account_row_present) output.blockers.push("account row missing")
  if (account && account.platform !== "fanvue") output.blockers.push("account platform is not fanvue")
  if (output.connection_status !== "CONNECTED") output.blockers.push("connection_status is not CONNECTED")
  if (!output.provider_account_id_present) output.blockers.push("provider account id missing")
  if (!output.encrypted_access_token_present) output.blockers.push("encrypted access token missing")
  if (!output.encrypted_refresh_token_present) output.blockers.push("encrypted refresh token missing")
  if (!output.token_expires_at_present) output.blockers.push("token expiry missing")
  if (tokenFreshness !== "fresh") output.blockers.push(`token freshness is ${tokenFreshness}`)
  if (!output.metadata_provider_is_fanvue) output.blockers.push("metadata provider is not fanvue")
  if (!output.metadata_identity_fetched) output.blockers.push("metadata identity_fetched is not true")
  if (!output.scopes_include_read_media) output.blockers.push("read:media scope missing")
  if (!output.scopes_include_write_media) output.blockers.push("write:media scope missing")

  output.ok = output.blockers.length === 0
  output.native_upload_readiness = output.ok ? "ready_for_upload_only_gate" : "blocked"
  return output
}

export async function planFanvuePostReconnectTokenPosturePreflight(
  args: FanvuePostReconnectPreflightArgs,
  dependencies: FanvuePostReconnectPreflightDependencies = { loadAccount: loadFanvuePostReconnectPreflightAccount },
): Promise<FanvuePostReconnectPreflightOutput> {
  if (args.platform && args.platform !== "fanvue") {
    const output = buildFanvuePostReconnectPreflightOutput(null, dependencies.nowMs?.() ?? Date.now())
    output.blockers = ["platform must be fanvue"]
    output.ok = false
    output.native_upload_readiness = "blocked"
    return output
  }
  if (!nonEmptyString(args.userId) || !UUID_RE.test(String(args.userId))) {
    const output = buildFanvuePostReconnectPreflightOutput(null, dependencies.nowMs?.() ?? Date.now())
    output.blockers = ["valid user id is required"]
    output.ok = false
    output.native_upload_readiness = "blocked"
    return output
  }

  let account: FanvuePostReconnectPreflightAccountRow | null
  try {
    account = await dependencies.loadAccount(String(args.userId))
  } catch {
    const output = buildFanvuePostReconnectPreflightOutput(null, dependencies.nowMs?.() ?? Date.now())
    output.blockers = ["account lookup failed safely"]
    output.ok = false
    output.native_upload_readiness = "blocked"
    return output
  }
  return buildFanvuePostReconnectPreflightOutput(account, dependencies.nowMs?.() ?? Date.now())
}

function fileUrlToCrossPlatformPath(value: string): string {
  try {
    return fileURLToPath(value)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    const url = new URL(value)
    if (url.protocol !== "file:") throw error
    return decodeURIComponent(url.pathname)
  }
}

function normalizeCliEntrypointPath(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const withoutFileProtocol = normalized.startsWith("file://") ? fileUrlToCrossPlatformPath(value).replace(/\\/g, "/") : normalized
  const withoutLeadingDriveSlash = withoutFileProtocol.replace(/^\/([A-Za-z]:\/)/, "$1")
  return path.resolve(withoutLeadingDriveSlash).replace(/\\/g, "/").toLowerCase()
}

export function isFanvuePostReconnectPreflightCliEntrypoint(argv: string[], importMetaUrl: string): boolean {
  const invokedPath = argv[1]
  if (!invokedPath) return false
  return normalizeCliEntrypointPath(invokedPath) === normalizeCliEntrypointPath(importMetaUrl)
}

export async function runFanvuePostReconnectPreflightCliMain(
  argv: string[] = process.argv.slice(2),
  write: (output: string) => void = console.log,
  dependencies?: FanvuePostReconnectPreflightDependencies,
): Promise<void> {
  const result = await planFanvuePostReconnectTokenPosturePreflight(parseFanvuePostReconnectPreflightArgs(argv), dependencies)
  write(JSON.stringify(result, null, 2))
  process.exitCode = 0
}

if (isFanvuePostReconnectPreflightCliEntrypoint(process.argv, import.meta.url)) {
  runFanvuePostReconnectPreflightCliMain().catch(() => {
    console.log(JSON.stringify({ ok: false, platform: "fanvue", native_upload_readiness: "blocked", blockers: ["preflight failed safely"] }))
    process.exitCode = 0
  })
}
