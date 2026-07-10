"use server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { saveCreatorPublishingPackage } from "@/lib/creator-publishing-queue/composer/service"
export type PackageComposerActionState={ok:boolean; code?:string; message?:string}
const uuid=z.string().uuid(); const ts=z.string().datetime({offset:true})
function bool(v:FormDataEntryValue|null){ return v==="on"||v==="true" }
function fields(fd:FormData){ return { platformAccountId:String(fd.get("platformAccountId")??""), title:String(fd.get("title")??""), captionBody:String(fd.get("captionBody")??""), secondPersonPresent:bool(fd.get("secondPersonPresent")), priceNotes:String(fd.get("priceNotes")??""), visibilityNotes:String(fd.get("visibilityNotes")??""), idempotencyKey:String(fd.get("idempotencyKey")??"") } }
function invalidForm():PackageComposerActionState{return {ok:false,code:"INVALID_FORM",message:"Check the package form and try again."}}
async function success(id:string){ revalidatePath("/creator/publishing-queue"); revalidatePath(`/creator/publishing-queue/${id}`); redirect(`/creator/publishing-queue/${id}`) }
export async function createCreatorPublishingPackage(_prev:PackageComposerActionState, fd:FormData): Promise<PackageComposerActionState>{ const result=await saveCreatorPublishingPackage({operation:"create", ...fields(fd)}); if(result.ok === false) return { ok:false, code: result.code, message: result.message }; await success(result.package.id) }
export async function updateCreatorPublishingPackage(_prev:PackageComposerActionState, fd:FormData): Promise<PackageComposerActionState>{ const id=uuid.safeParse(String(fd.get("contentPackageId")??"")); const exp=ts.safeParse(String(fd.get("expectedUpdatedAt")??"")); if(!id.success||!exp.success) return invalidForm(); const result=await saveCreatorPublishingPackage({operation:"update", contentPackageId:id.data, expectedUpdatedAt:exp.data, ...fields(fd)}); if(result.ok === false) return { ok:false, code: result.code, message: result.message }; await success(result.package.id) }
