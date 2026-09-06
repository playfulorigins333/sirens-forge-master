import {redirect} from "next/navigation";import {supabaseServer} from "@/lib/supabaseServer";import SupportClient from "./SupportClient"
export const dynamic="force-dynamic";export default async function Page(){const{data:{user}}=await(await supabaseServer()).auth.getUser();if(!user)redirect("/login");return <SupportClient/>}
