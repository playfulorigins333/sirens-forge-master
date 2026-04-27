import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function DMCAPage() {
  return (
    <LegalPageLayout title="DMCA Policy" lastUpdated="April 27, 2026">
      <section>
        <p>
          Sirens Forge respects the intellectual property rights of others and
          complies with the Digital Millennium Copyright Act (DMCA). This policy
          outlines the process for submitting copyright infringement claims and
          our response procedures.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          1. Filing a DMCA Takedown Notice
        </h2>
        <p>
          If you believe that content available through Sirens Forge infringes
          your copyright, you may submit a written DMCA notice. Your notice must
          include the following:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Your full legal name and contact information</li>
          <li>A description of the copyrighted work claimed to be infringed</li>
          <li>
            Identification of the material that is claimed to be infringing,
            including its location (URL, reference, or description)
          </li>
          <li>
            A statement that you have a good faith belief that the use of the
            material is not authorized by the copyright owner, its agent, or the law
          </li>
          <li>
            A statement that the information in the notice is accurate and, under
            penalty of perjury, that you are authorized to act on behalf of the
            copyright owner
          </li>
          <li>Your physical or electronic signature</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Submission Method</h2>
        <p>
          DMCA notices should be submitted to:
        </p>
        <p className="font-medium">admin@sirensforge.com</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Review and Action</h2>
        <p>
          Upon receiving a valid DMCA notice, Sirens Forge may:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Remove or disable access to the allegedly infringing content</li>
          <li>Notify the user associated with the content</li>
          <li>Restrict or terminate accounts in cases of repeated violations</li>
        </ul>
        <p>
          We reserve the right to evaluate the validity of claims and may request
          additional information before taking action.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Counter-Notification</h2>
        <p>
          If you believe that your content was removed in error or due to
          misidentification, you may submit a counter-notification. Your
          counter-notice must include:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Your name and contact information</li>
          <li>Identification of the material that was removed</li>
          <li>
            A statement under penalty of perjury that you have a good faith
            belief the material was removed as a result of mistake or
            misidentification
          </li>
          <li>
            A statement that you consent to the jurisdiction of your local
            federal court (or appropriate jurisdiction if outside the U.S.)
          </li>
          <li>Your physical or electronic signature</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          5. Repeat Infringer Policy
        </h2>
        <p>
          Sirens Forge may terminate user accounts that are determined to be
          repeat infringers or that repeatedly violate intellectual property
          rights.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. Misrepresentation
        </h2>
        <p>
          Any person who knowingly submits a false DMCA notice or
          counter-notification may be subject to legal liability. Sirens Forge
          reserves the right to deny or ignore invalid or abusive claims.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Platform Role
        </h2>
        <p>
          Sirens Forge acts as a service provider and does not actively monitor
          all user-generated content. Content is generated and controlled by
          users, and we do not guarantee ownership, originality, or legality of
          user-submitted or generated materials.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Contact</h2>
        <p>
          For DMCA-related inquiries, contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}