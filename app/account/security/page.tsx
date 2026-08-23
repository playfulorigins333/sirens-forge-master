import { redirect } from "next/navigation"
import { supabaseServer } from "@/lib/supabaseServer"
import SecurityClient from "./SecurityClient"

export const dynamic = "force-dynamic"
export default async function SecurityPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  return <SecurityClient />
}
