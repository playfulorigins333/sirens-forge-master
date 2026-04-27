import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function ComplaintsPage() {
  return (
    <LegalPageLayout title="Complaints Policy" lastUpdated="April 27, 2026">
      <section>
        <p>
          Sirens Forge provides a process for users and third parties to submit
          complaints, report concerns, and request review of actions taken on the
          platform. This policy outlines how complaints are handled and what
          users can expect during the review process.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Types of Complaints</h2>
        <p>
          Complaints may include, but are not limited to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Account suspensions or bans</li>
          <li>Content removal or restrictions</li>
          <li>Alleged policy violations</li>
          <li>Unauthorized use of likeness or identity</li>
          <li>Privacy or safety concerns</li>
          <li>Platform errors or unexpected behavior</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          2. Submitting a Complaint
        </h2>
        <p>
          To submit a complaint, contact us at:
        </p>
        <p className="font-medium">admin@sirensforge.com</p>
        <p>
          Please include as much detail as possible to help us evaluate your
          request:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Your account email (if applicable)</li>
          <li>A description of the issue</li>
          <li>Relevant links, screenshots, or references</li>
          <li>Any supporting information</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Review Process</h2>
        <p>
          Sirens Forge reviews complaints in good faith and may request
          additional information where necessary. We evaluate each case based on
          our Terms of Service, Acceptable Use Policy, safety standards, and
          applicable law.
        </p>
        <p>
          We reserve the right to determine the outcome of any complaint at our
          sole discretion.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          4. Possible Outcomes
        </h2>
        <p>
          Following review, Sirens Forge may:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Uphold the original action</li>
          <li>Modify restrictions or account status</li>
          <li>Restore access or content where appropriate</li>
          <li>Remove content or apply additional enforcement</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          5. No Guarantee of Reversal
        </h2>
        <p>
          Submission of a complaint does not guarantee reversal of any decision.
          Sirens Forge retains full authority over enforcement actions and
          platform access.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. Abuse of Complaint Process
        </h2>
        <p>
          Repeated, abusive, or bad-faith complaints may result in restrictions,
          denial of further review, or additional enforcement actions.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Legal and Compliance Requests
        </h2>
        <p>
          Complaints involving legal claims, law enforcement, or regulatory
          matters may be handled separately in accordance with applicable laws
          and obligations.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          8. Response Time
        </h2>
        <p>
          Sirens Forge aims to review complaints within a reasonable timeframe,
          but response times may vary depending on complexity, volume, and the
          nature of the request.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Contact</h2>
        <p>
          For complaints or appeals, contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}