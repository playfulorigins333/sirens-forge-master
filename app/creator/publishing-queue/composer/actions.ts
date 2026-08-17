"use server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { saveCreatorPublishingPackage } from "@/lib/creator-publishing-queue/composer/service"
import type { ComposerPackage } from "@/lib/creator-publishing-queue/composer/types"

export type PackageComposerActionState = { ok: boolean; code?: string; message?: string }
const uuid = z.string().uuid()
const ts = z.string().datetime({ offset: true })

function bool(value: FormDataEntryValue | null) {
  return value === "on" || value === "true"
}

function fields(formData: FormData) {
  return {
    platformAccountId: String(formData.get("platformAccountId") ?? ""),
    title: String(formData.get("title") ?? ""),
    captionBody: String(formData.get("captionBody") ?? ""),
    secondPersonPresent: bool(formData.get("secondPersonPresent")),
    priceNotes: String(formData.get("priceNotes") ?? ""),
    visibilityNotes: String(formData.get("visibilityNotes") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  }
}

function invalidForm(): PackageComposerActionState {
  return { ok: false, code: "INVALID_FORM", message: "Check the package form and try again." }
}

async function success(pkg: Pick<ComposerPackage, "id" | "target_platform">) {
  const id = pkg.id
  revalidatePath("/creator/publishing-queue")
  revalidatePath(`/creator/publishing-queue/${id}`)
  if (pkg.target_platform === "fanvue") {
    revalidatePath(`/creator/publishing-queue/fanvue/packages/${id}/media`)
    redirect(`/creator/publishing-queue/fanvue/packages/${id}/media`)
  }
  redirect(`/creator/publishing-queue/${id}`)
}

export async function createCreatorPublishingPackage(
  _prev: PackageComposerActionState,
  formData: FormData,
): Promise<PackageComposerActionState> {
  const result = await saveCreatorPublishingPackage({ operation: "create", ...fields(formData) })
  if (result.ok === false) return { ok: false, code: result.code, message: result.message }
  await success(result.package)
}

export async function updateCreatorPublishingPackage(
  _prev: PackageComposerActionState,
  formData: FormData,
): Promise<PackageComposerActionState> {
  const id = uuid.safeParse(String(formData.get("contentPackageId") ?? ""))
  const expectedUpdatedAt = ts.safeParse(String(formData.get("expectedUpdatedAt") ?? ""))
  if (!id.success || !expectedUpdatedAt.success) return invalidForm()
  const result = await saveCreatorPublishingPackage({
    operation: "update",
    contentPackageId: id.data,
    expectedUpdatedAt: expectedUpdatedAt.data,
    ...fields(formData),
  })
  if (result.ok === false) return { ok: false, code: result.code, message: result.message }
  await success(result.package)
}
