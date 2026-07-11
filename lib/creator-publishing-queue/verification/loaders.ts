import "server-only"
import { redirect } from "next/navigation"
import { supabaseServer } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { buildTrustedVerificationCreatorIds, TRUSTED_VERIFICATION_ACCOUNT_SUBJECT_LIMIT, TRUSTED_VERIFICATION_CREATOR_LIMIT, TRUSTED_VERIFICATION_DISCOVERY_MAX_PAGES, TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE, type VerificationCreatorIdRow } from "./subjectDiscovery"
export type VerificationSubjectRow = { subjectType: "creator" | "platform_account"; subjectId: string; creatorId: string; platform?: "onlyfans" | "fansly"; platformUsername?: string; status: string; expectedUpdatedAt: string | null; selfReviewDisabled: boolean }

type TrustedAdminClient = ReturnType<typeof getSupabaseAdmin>
type AccountDisplayRow = { id: string; creator_id: string; platform: "onlyfans" | "fansly"; platform_username: string; verification_status: string; updated_at: string }
const DISCOVERY_ERROR = "Verification subjects could not be loaded."
const DISCOVERY_BOUNDARY_ERROR = "Verification subject discovery exceeded its safe pagination boundary."

async function loadDiscoveryPage(admin: TrustedAdminClient, table: "creator_publishing_content_packages" | "creator_platform_accounts", platformColumn: "target_platform" | "platform", from: number, to: number) {
  if (table === "creator_publishing_content_packages") return admin.from("creator_publishing_content_packages").select("id,creator_id").in("target_platform", ["onlyfans", "fansly"]).not("creator_id", "is", null).order("creator_id", { ascending: true }).order("id", { ascending: true }).range(from, to)
  return admin.from("creator_platform_accounts").select("id,creator_id").in("platform", ["onlyfans", "fansly"]).not("creator_id", "is", null).order("creator_id", { ascending: true }).order("id", { ascending: true }).range(from, to)
}

async function loadCreatorRowsByPages(admin: TrustedAdminClient, table: "creator_publishing_content_packages" | "creator_platform_accounts", platformColumn: "target_platform" | "platform"): Promise<VerificationCreatorIdRow[]> {
  const rows: VerificationCreatorIdRow[] = []
  for (let page = 0; page < TRUSTED_VERIFICATION_DISCOVERY_MAX_PAGES; page += 1) {
    const from = page * TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE
    const to = from + TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE - 1
    const { data, error } = await loadDiscoveryPage(admin, table, platformColumn, from, to)
    if (error) throw new Error(DISCOVERY_ERROR)
    const pageRows = (data ?? []) as VerificationCreatorIdRow[]
    rows.push(...pageRows)
    if (pageRows.length < TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE) return rows
  }
  const probeFrom = TRUSTED_VERIFICATION_DISCOVERY_MAX_PAGES * TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE
  const { data: probe, error: probeError } = await loadDiscoveryPage(admin, table, platformColumn, probeFrom, probeFrom)
  if (probeError) throw new Error(DISCOVERY_ERROR)
  if ((probe ?? []).length > 0) throw new Error(DISCOVERY_BOUNDARY_ERROR)
  return rows
}

export async function loadSupportedPackageCreatorRows(admin: TrustedAdminClient): Promise<VerificationCreatorIdRow[]> { return loadCreatorRowsByPages(admin, "creator_publishing_content_packages", "target_platform") }
export async function loadSupportedAccountCreatorRows(admin: TrustedAdminClient): Promise<VerificationCreatorIdRow[]> { return loadCreatorRowsByPages(admin, "creator_platform_accounts", "platform") }

export async function requireTrustedVerificationReviewer() { const supabase = await supabaseServer(); const { data } = await supabase.auth.getUser(); if (!data.user?.id) redirect("/login"); const admin = getSupabaseAdmin(); const { data: reviewer, error } = await admin.from("creator_publishing_trusted_reviewers").select("reviewer_id,role,active,revoked_at").eq("reviewer_id", data.user.id).maybeSingle(); if (error || !reviewer || !reviewer.active || reviewer.revoked_at || !["admin","reviewer","service_reviewer"].includes(reviewer.role)) redirect("/creator/publishing-queue"); return { reviewerId: data.user.id, role: reviewer.role as string } }
export async function loadTrustedVerificationSubjects(): Promise<{ reviewerId: string; subjects: VerificationSubjectRow[] }> { const { reviewerId } = await requireTrustedVerificationReviewer(); const admin = getSupabaseAdmin(); const accountSubjectDisplayQuery = admin.from("creator_platform_accounts").select("id,creator_id,platform,platform_username,verification_status,updated_at").in("platform", ["onlyfans", "fansly"]).order("creator_id", { ascending: true }).order("id", { ascending: true }).limit(TRUSTED_VERIFICATION_ACCOUNT_SUBJECT_LIMIT); const [packageCreatorRows, accountCreatorRows, accountsRes] = await Promise.all([loadSupportedPackageCreatorRows(admin), loadSupportedAccountCreatorRows(admin), accountSubjectDisplayQuery]); if (accountsRes.error) throw new Error(DISCOVERY_ERROR); const ids = buildTrustedVerificationCreatorIds(packageCreatorRows, accountCreatorRows, TRUSTED_VERIFICATION_CREATOR_LIMIT); const verRes = ids.length ? await admin.from("creator_publishing_creator_verifications").select("creator_id,status,updated_at").in("creator_id", ids) : { data: [], error: null }; if (verRes.error) throw new Error("Creator verification status could not be loaded."); const byCreator = new Map(((verRes.data ?? []) as any[]).map(r => [r.creator_id, r])); const creatorSubjects = ids.map(id => { const row = byCreator.get(id); return { subjectType: "creator" as const, subjectId: id, creatorId: id, status: row?.status ?? "unverified", expectedUpdatedAt: row?.updated_at ?? null, selfReviewDisabled: id === reviewerId } }); const accountSubjects = ((accountsRes.data ?? []) as AccountDisplayRow[]).map(a => ({ subjectType: "platform_account" as const, subjectId: a.id, creatorId: a.creator_id, platform: a.platform, platformUsername: a.platform_username, status: a.verification_status, expectedUpdatedAt: a.updated_at, selfReviewDisabled: a.creator_id === reviewerId })); return { reviewerId, subjects: [...creatorSubjects, ...accountSubjects] } }
