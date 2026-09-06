import Link from "next/link"
import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="September 5, 2026">
      <section>
        <p>
          This Privacy Policy explains how Sirens Forge collects, uses, stores,
          shares, protects, exports, and retains information when you access or
          use the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p>We may collect the following types of information:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Account information, such as email address and authentication details</li>
          <li>Billing and subscription information processed through payment providers</li>
          <li>Prompts, uploads, references, identity inputs, and generated content</li>
          <li>LoRA-related materials, identity assets, vault content, and generation history</li>
          <li>Usage data, logs, device data, browser data, IP address, and system activity</li>
          <li>Support requests, complaints, reports, appeals, and other communications</li>
          <li>Policy-acceptance, consent, deletion, export, security, and governance evidence</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. How We Use Information</h2>
        <p>We may use information to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Operate, maintain, and secure Sirens Forge</li>
          <li>Create accounts, authenticate users, and manage platform access</li>
          <li>Process payments, subscriptions, refunds, disputes, and billing records</li>
          <li>Generate, store, display, and deliver user-requested outputs</li>
          <li>Provide identity, vault, LoRA, generation, and creator-related features</li>
          <li>Process creator export, account-deletion, recovery, and reactivation requests</li>
          <li>Detect, investigate, prevent, and enforce against misuse or policy violations</li>
          <li>Respond to support requests, complaints, takedown requests, and legal inquiries</li>
          <li>Comply with legal obligations and protect the rights, safety, and integrity of the platform</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          3. AI Prompts, Uploads, Identity Inputs, and Outputs
        </h2>
        <p>
          Prompts, uploaded files, reference images, identity materials,
          LoRA-related materials, and generated outputs may be processed, stored,
          displayed, transmitted, or retained only as needed to provide requested
          features, secure the service, provide legitimate support and
          troubleshooting, conduct safety or compliance review, prevent fraud or
          abuse, satisfy legal obligations, and operate implemented automated
          policy controls.
        </p>
        <p>
          You should not submit sensitive personal information, confidential
          material, private third-party data, or content you do not have the
          legal right or consent to use.
        </p>
        <p>
          Private creator uploads, identity or Twin materials, prompts, and
          generated content are not used for generalized model training by
          default. Any future generalized model-training or improvement use of
          private creator content requires a separate explicit opt-in. Sirens
          Forge never sells creator personal data or creator content, and private
          creator content is not used to build advertising or marketing profiles.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Safety, Compliance, and Review</h2>
        <p>
          Automated safety, security, and policy controls may analyze inputs and
          system or account activity where implemented. Automated processing does
          not imply casual human browsing of private creator content. Human
          access to private creator content is purpose-limited to
          creator-requested support, genuine technical troubleshooting, safety or
          NCII investigation, fraud or security investigation, or a legal
          requirement.
        </p>
        <p>
          We may restrict access, suspend accounts, remove content, preserve
          records, or report activity if we believe it violates our Terms,
          policies, payment rules, or applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Payment Processing</h2>
        <p>
          Payments are processed through third-party payment providers such as
          Stripe. We do not store full payment card numbers. Payment providers
          process billing information according to their own terms, privacy
          policies, security practices, and legal obligations.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Third-Party Services</h2>
        <p>
          Sirens Forge may use third-party services for hosting, storage,
          authentication, analytics, email, payments, AI processing, content
          delivery, security, infrastructure, customer support, and business
          operations. Provider processing is purpose-limited to the minimum
          information necessary to deliver and support the assigned service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Sharing of Information</h2>
        <p>
          We may share information with service providers, payment processors,
          infrastructure providers, legal advisors, enforcement authorities, or
          other parties when necessary to operate the platform, enforce our
          policies, comply with legal obligations, respond to valid requests,
          investigate abuse, protect safety, prevent fraud, or complete a
          business transaction such as a merger, acquisition, financing, or sale
          of assets.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Cookies and Similar Technologies</h2>
        <p>
          We may use cookies, local storage, pixels, analytics tools, and similar
          technologies to keep users logged in, secure accounts, remember
          preferences, analyze usage, improve performance, prevent abuse, and
          support platform functionality. Browser settings may allow you to
          block or delete some cookies, but doing so may affect platform
          functionality.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Data Storage and Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect
          information. However, no internet-based service, cloud provider,
          storage system, AI processing system, or transmission method can be
          guaranteed to be completely secure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Data Retention</h2>
        <p>
          Sirens Forge uses documented retention rules by data category rather
          than a single indefinite period. Current platform controls include
          30-day Recently Deleted windows for private generation media and Twin
          materials, a 60-day voluntary account-deletion recovery period, a
          60-day post-cancellation retention period after recurring paid access
          ends, and a 60-day retention period after the second missed recurring
          subscription payment. Draft working data uses a 90-day retention rule,
          while security and governance audit evidence is retained for 12 months.
          Aggregate or de-identified information may be retained longer where it
          no longer identifies a creator.
        </p>
        <p>
          Retention may be extended or destructive deletion blocked where a
          valid legal hold, dispute, fraud investigation, security requirement,
          payment record, legal obligation, backup-restoration constraint, or
          other documented lawful exception applies. Any retained exception is
          limited to the purpose requiring preservation.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          11. Data Export and Voluntary Account Deletion
        </h2>
        <p>
          Authenticated creators may request an account data export through the
          available account controls. Export requests move through a processing
          lifecycle and completed export packages are made available only for a
          limited period before expiry. Export integrity evidence may include a
          cryptographic hash and minimal non-content metadata.
        </p>
        <p>
          Authenticated creators may also request voluntary account deletion.
          Before deletion is requested, the creator chooses whether to request an
          export before deletion or to skip that export. The deletion request
          then enters a 60-day recovery period. Creator-product access is frozen
          during that period while data-rights, account-security, billing
          recovery, and reactivation controls remain available. Reactivation
          during the recovery period cancels the pending deletion. If the
          recovery period ends without reactivation, eligible creator data moves
          into the controlled purge process.
        </p>
        <p>
          Deletion does not erase records that must or may lawfully be retained
          for billing, fraud prevention, security, dispute resolution, legal
          compliance, immutable audit evidence, or an active legal hold. A valid
          active legal hold blocks destructive deletion of material within its
          documented scope until the hold is released or expires.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">12. Governance and Audit Evidence</h2>
        <p>
          Sirens Forge maintains append-only governance evidence for selected
          high-risk privacy, billing, security, consent, policy-acceptance,
          deletion, export, and legal-hold actions. These records are designed to
          store scoped metadata, policy and form versions, timestamps,
          correlation identifiers, and cryptographic references rather than
          plaintext secrets, raw access tokens, private binary content, prompts,
          or captions.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          13. Connected Social-Platform Accounts
        </h2>
        <p>
          When a creator disconnects a connected social-platform account, OAuth
          credentials and access tokens are revoked or deleted, and unpublished
          scheduled jobs associated with that account are cancelled.
          Disconnecting an account does not delete or alter content already
          published on an external platform.
        </p>
        <p>
          Imported platform data is deleted or de-identified when required by a
          creator deletion request, account closure, or applicable platform
          deletion notice. Applicable deletion notices are synchronized with
          retained Sirens Forge records, except for records narrowly necessary
          for legal, fraud-prevention, security, dispute-resolution, or immutable
          audit purposes. Any retained exception is minimized and is not used
          for future publishing or marketing.
        </p>
        <p>
          For data obtained through a connected platform API, any retained
          exception applies only to the extent required by applicable law or
          expressly permitted by that platform&apos;s terms or written approval.
          Deleted or removed platform content is not retained in audit records.
          Any permitted audit record is limited to minimal non-content metadata.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">14. Content Removal and Complaints</h2>
        <p>
          If you believe content on or generated through Sirens Forge violates
          your rights, privacy, consent, likeness, copyright, or our policies,
          you may contact us with a removal request or complaint. Reports of
          nonconsensual or unauthorized intimate content may use the dedicated
          <Link className="text-cyan-400 hover:underline" href="/report-intimate-content"> public reporting route</Link>. We may request additional information to
          evaluate the report and may take action under our policies or where
          required by law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">15. User Responsibility</h2>
        <p>
          You are responsible for ensuring that prompts, uploads, references,
          likenesses, identity materials, account activity, and generated content
          you submit or create do not violate privacy rights, intellectual
          property rights, publicity rights, consent requirements, contractual
          obligations, platform policies, or applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">16. Children and Minors</h2>
        <p>
          Sirens Forge is strictly for adults aged 18 and older. We do not
          knowingly collect information from anyone under 18. If we become aware
          that a minor has used the service or submitted information, we may
          delete the account, remove related data, restrict access, and take any
          other action required or appropriate under our policies or applicable
          law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          17. International Users and Data Transfers
        </h2>
        <p>
          Sirens Forge may process and store information in the United States or
          other locations where our service providers operate. By using the
          platform, you understand that your information may be transferred to
          and processed in jurisdictions that may have different data protection
          laws than your location.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          18. Policy Versions and Material Changes
        </h2>
        <p>
          We may update this Privacy Policy. The current material policy bundle
          identifies the applicable Terms of Service, Privacy Policy, and
          Acceptable Use Policy by version and source evidence. When a new
          material bundle becomes current, creator-product access may require
          active acceptance of that bundle before protected creator features
          resume. Sirens Forge records durable checkout or authenticated
          re-consent receipts for the accepted current bundle.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">19. Contact</h2>
        <p>
          For questions about this Privacy Policy, contact us at
          admin@sirensforge.vip.
        </p>
      </section>
    </LegalPageLayout>
  )
}
