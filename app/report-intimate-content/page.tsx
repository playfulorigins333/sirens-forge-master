import LegalPageLayout from "@/components/legal/LegalPageLayout"
import SafetyReportForm from "@/components/safety/SafetyReportForm"

const subject = "Nonconsensual Intimate Content / Removal Report"
const body = `Reporter name and safe contact information:

I am the depicted/affected person or authorized to act for them (explain):

Stable content URL, asset ID, account reference, or other location:

Description of the content or concern:

Why I believe the depiction is nonconsensual or unauthorized:

Requested action:

Good-faith statement: The information supplied is accurate to my knowledge.

Minimum necessary supporting information (if applicable):`
const mailto = `mailto:admin@sirensforge.vip?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export default function ReportIntimateContentPage() {
  return (
    <LegalPageLayout title="Report Nonconsensual Intimate Content / Request Removal" lastUpdated="September 6, 2026">
      <section><p>This public reporting path is available without a Sirens Forge account. It is for nonconsensual intimate imagery and unauthorized intimate depictions of identifiable real people, including AI-generated or AI-altered deepfakes and face swaps. General complaints and copyright matters remain available through their separate public processes.</p></section>
      <SafetyReportForm category="NCII" title="Submit an NCII or unauthorized intimate-content report" ncii />
      <section><h2 className="text-xl font-semibold">Email fallback</h2><p>If the form is unavailable, email <a className="text-cyan-400 hover:underline" href="mailto:admin@sirensforge.vip">admin@sirensforge.vip</a>.</p><p><a className="inline-flex rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black hover:bg-cyan-400" href={mailto}>Open a prefilled email report</a></p></section>
      <section><h2 className="text-xl font-semibold">What to include, where applicable</h2><ul className="list-disc pl-6 space-y-2"><li>Your name and safe contact information</li><li>Whether you are the depicted or affected person, or are authorized to act for them</li><li>A stable content URL, asset ID, account reference, or other location information</li><li>A description of the content and concern</li><li>Why you believe the depiction is nonconsensual or unauthorized</li><li>The action you request</li><li>A good-faith statement that the information supplied is accurate to your knowledge</li><li>Only the minimum necessary supporting information</li></ul></section>
      <section><h2 className="text-xl font-semibold">Protect sensitive information</h2><p>Do not send passwords, access tokens, session cookies, secret keys, or other credentials. Do not unnecessarily download, copy, forward, or re-upload potentially illegal or highly sensitive material merely to report it. Stable references and descriptions are preferred where sufficient.</p></section>
      <section><h2 className="text-xl font-semibold">Safety escalation</h2><p>Reports involving suspected minors or potentially illegal exploitative content receive safety escalation under the existing complaints and removal process. This statement does not make a legal conclusion or promise a particular deadline or outcome.</p></section>
    </LegalPageLayout>
  )
}
