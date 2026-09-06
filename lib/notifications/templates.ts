import "server-only"
import type { Mail, NotificationKind } from "./types"
const base=(path:string)=>`${(process.env.NEXT_PUBLIC_SITE_URL || "https://www.sirensforge.vip").replace(/\/$/,"")}${path}`
const date=(value:string|null|undefined)=>{if(!value) throw new Error("TEMPLATE_DATE_MISSING"); return new Intl.DateTimeFormat("en-US",{dateStyle:"long",timeZone:"UTC"}).format(new Date(value))}
const render=(subject:string,reason:string,action:string,url:string):Mail=>{const text=`${subject}\n\n${reason}\n\n${action}: ${url}\n\nThis is a transactional account notice from Sirens Forge.`; const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); return {subject,text,html:`<!doctype html><html><body><h1>${esc(subject)}</h1><p>${esc(reason)}</p><p><a href="${esc(url)}">${esc(action)}</a></p><p>This is a transactional account notice from Sirens Forge.</p></body></html>`}}
export function buildNotification(kind:NotificationKind,c:Record<string,string|null>):Mail {
 switch(kind){
  case "export_ready": return render("Your Sirens Forge data export is ready",`Your requested export is available until ${date(c.expiresAt)}.`,"Open data rights",base("/account/data-rights"))
  case "deletion_requested": return render("Account deletion recovery period started",`You requested account deletion. You may reactivate through ${date(c.recoveryDeadline)}. After the recovery period, deletion proceeds subject to lawful preservation obligations.`,"Review account settings",base("/account"))
  case "deletion_reactivated": return render("Account deletion canceled","Your account was reactivated and the pending deletion request was canceled.","Open account settings",base("/account"))
  case "deletion_completed": return render("Account deletion lifecycle completed",`Your deletion lifecycle completed${c.completedAt?` on ${date(c.completedAt)}`:""}. Some records may be retained where required by law or compliance obligations.`,"Review data rights",base("/account/data-rights"))
  default: {const cancellation=kind.startsWith("cancellation_"); const day=kind.match(/day_(\d+)/)?.[1]; const until=date(c.retentionUntil); return render(cancellation?`Subscription cancellation retention: day ${day}`:`Payment delinquency retention: day ${day}`,cancellation?`Your paid access ended on ${date(c.paidAccessEndsAt)}. Your retained workspace is scheduled through ${until}, subject to lawful preservation obligations.`:`Your payment delinquency retention period is scheduled through ${until}, subject to lawful preservation obligations.`,cancellation?"Review billing":"Resolve billing",base("/billing"))}
 }
}
