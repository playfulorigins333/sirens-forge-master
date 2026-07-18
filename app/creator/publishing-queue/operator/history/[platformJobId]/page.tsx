import Link from "next/link"
import { loadOperatorOnlyFansJobHistory } from "@/lib/creator-publishing-queue/onlyfans-history/loaders"
import { OnlyFansHistoryTimeline } from "../../../OnlyFansHistoryTimeline"
export const metadata = { title: "OnlyFans job history — Sirens Forge" }
export default async function OnlyFansOperatorTerminalHistoryDetailPage({params}:{params:Promise<{platformJobId:string}>}){ const {platformJobId}=await params; const history=await loadOperatorOnlyFansJobHistory(platformJobId); return <main className="min-h-screen bg-black px-4 py-10 text-white sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl"><Link href="/creator/publishing-queue/operator/history" className="text-sm text-fuchsia-200 underline">Back to completed history</Link><h1 className="mt-6 text-4xl font-bold">OnlyFans job history</h1><OnlyFansHistoryTimeline view={history} audience="operator"/></div></main> }
