import Link from "next/link"
import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="August 22, 2026">
      <section>
        <p>
          This Privacy Policy explains how Sirens Forge collects, uses, stores,
          shares, protects, and retains information when you access or use the
          platform.
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
          guaranteed to be completely secure. You use the platform at your own
          risk.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Data Retention</h2>
        <p>
          We retain information only as needed to provide the service, maintain
          necessary business and billing records, comply with legal obligations,
          resolve disputes, prevent fraud, investigate abuse, maintain backups,
          secure the platform, and support documented enforcement decisions.
          Retention varies by the type of data and the purpose for which it is
          held.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Data Deletion Requests</h2>
        <p>
          You may contact us to request deletion of your account or certain
          stored data. We may deny, delay, or limit deletion where retention is
          required or permitted for billing, security, legal compliance, abuse
          prevention, dispute resolution, enforcement, backups, fraud prevention,
          or other documented necessary purposes. Requests use the current manual
          contact process; this policy does not represent that automated account
          deletion, reactivation, Recently Deleted, full export, or purge controls
          are currently available.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          12. Connected Social-Platform Accounts
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
          expressly permitted by that platform’s terms or written approval.
          Deleted or removed platform content is not retained in audit records.
          Any permitted audit record is limited to minimal non-content metadata.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">13. Content Removal and Complaints</h2>
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
        <h2 className="text-xl font-semibold">14. User Responsibility</h2>
        <p>
          You are responsible for ensuring that prompts, uploads, references,
          likenesses, identity materials, account activity, and generated content
          you submit or create do not violate privacy rights, intellectual
          property rights, publicity rights, consent requirements, contractual
          obligations, platform policies, or applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">15. Children and Minors</h2>
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
          16. International Users and Data Transfers
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
        <h2 className="text-xl font-semibold">17. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy. We will post the updated version and
          date and provide additional notice or obtain acceptance when required.
          This provision does not claim that a general automated material-policy
          re-consent system currently exists.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">18. Contact</h2>
        <p>
          For questions about this Privacy Policy, contact us at
          admin@sirensforge.vip.
        </p>
      </section>
    </LegalPageLayout>
  )
}
