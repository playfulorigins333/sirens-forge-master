import Link from "next/link"
import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="September 5, 2026">
      <section>
        <p>
          Welcome to Sirens Forge. By accessing or using our platform, you agree
          to these Terms of Service and all policies published by Sirens Forge,
          including our Privacy Policy, Acceptable Use Policy, and any other
          legal or safety policies we publish or update from time to time. If you
          do not agree, you may not use the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Eligibility</h2>
        <p>
          Sirens Forge is strictly for adults aged 18 and older. By using this
          service, you confirm that you are at least 18 years old, legally an
          adult in your jurisdiction, and permitted to access adult-oriented
          content.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Account Responsibility</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account
          and for all activity that occurs under your account. You agree not to
          share access, sell access, transfer your account, or allow
          unauthorized use.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Subscriptions and Billing</h2>
        <p>
          Sirens Forge operates on paid-access plans that may include recurring
          subscriptions and non-recurring or lifetime access. By purchasing
          access, you agree to billing through our payment provider. Recurring
          subscriptions may be cancelled through available billing controls and
          remain subject to the paid-through access period shown for the account.
          Non-recurring or lifetime access is not treated as a cancellable
          recurring subscription. Refunds are not guaranteed for unused time,
          digital access, lifetime access, or consumed services unless required
          by law.
        </p>
        <p>
          If a recurring payment fails, creator-product access may be frozen
          during payment recovery. After the second missed payment, a documented
          retention countdown may begin before deletion of eligible retained
          creator data. Billing records, fraud-prevention records, immutable
          audit evidence, legal-hold material, and other records that must or may
          lawfully be preserved are handled separately from creator-content
          deletion.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Use of the Service</h2>
        <p>
          You agree to use Sirens Forge only for lawful purposes and in
          accordance with our Acceptable Use Policy, safety rules, and platform
          restrictions. You may not use the platform to generate, upload, store,
          sell, distribute, or promote content that violates applicable law, the
          rights of others, or our policies. Features may use asynchronous queues
          and may be delayed, limited, rejected, or unavailable because of
          capacity, safety controls, maintenance, or fair-use limits. Access does
          not guarantee a particular processing time, volume, output, or
          uninterrupted compute availability.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. AI-Generated Content</h2>
        <p>
          Sirens Forge provides AI-generated outputs based on user inputs,
          prompts, uploads, identity materials, and settings. Outputs are
          generated automatically and are not guaranteed to be accurate, lawful,
          suitable, safe, unique, or appropriate for any particular
          purpose. You are solely responsible for reviewing and using any output.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. User Content, Uploads, and Ownership
        </h2>
        <p>
          You retain ownership of content you submit or create using the
          platform, subject to any rights held by third parties. By using Sirens
          Forge, you grant us a limited, non-exclusive license to process, store,
          display, and transmit the minimum creator material necessary to deliver
          requested features, secure the service, provide creator-requested
          support and genuine technical troubleshooting, conduct safety or
          compliance review, prevent fraud or abuse, satisfy legal obligations,
          and enforce platform rules through implemented automated controls.
          Private creator uploads, identity or Twin materials, prompts, and
          generated content are not used for generalized model training by
          default. Any future generalized model-training or improvement use of
          private creator content requires a separate explicit opt-in.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Identity and Likeness Responsibility
        </h2>
        <p>
          You are solely responsible for ensuring that you have the legal right,
          consent, license, or authorization to use any likeness, identity,
          reference image, voice, name, persona, or other identifying material
          submitted to or generated through Sirens Forge. Sirens Forge applies
          consent, verification, likeness, safety, and platform controls where
          implemented, but those controls do not independently establish every
          legal right. General generation may use a fully synthetic fictional
          persona and does not require every persona to resemble the creator.
          Fanvue may permit a fully synthetic fictional AI persona that does not
          resemble the verified human account owner, subject to Fanvue
          requirements. The OnlyFans launch workflow is likeness-bound: content
          prepared for that workflow must depict the verified creator and comply
          with its consent, verification, disclosure, and manual-handoff
          requirements.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Prohibited Conduct</h2>
        <p>
          You may not use Sirens Forge to create, request, upload, store, or
          distribute content involving minors, underage-looking characters,
          non-consensual sexual activity, exploitation, coercion, harassment,
          blackmail, abuse, trafficking, fraud, threats, or illegal activity.
          Violations may result in immediate account termination and reporting
          where appropriate or legally required.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          9. Content Removal and Complaints
        </h2>
        <p>
          Sirens Forge provides processes for reporting abuse, requesting
          content removal, submitting complaints, or raising intellectual
          property concerns. We may remove content, restrict access, preserve
          evidence, suspend accounts, or take other action under our policies or
          where required by law. Reports of nonconsensual or unauthorized
          intimate content may use the dedicated <Link className="text-cyan-400 hover:underline" href="/report-intimate-content">public reporting route</Link>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Monitoring and Enforcement</h2>
        <p>
          Automated safety, security, and policy controls may analyze system and
          account activity where implemented. Automated processing does not imply
          casual human browsing of private creator content. Human access to such
          content is purpose-limited to creator-requested support, genuine
          technical troubleshooting, safety or NCII investigation, fraud or
          security investigation, or a legal requirement. We may preserve or
          remove content and enforce platform rules where supported by policy,
          safety, security, or legal needs.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          11. Data Export, Account Deletion, and Legal Holds
        </h2>
        <p>
          Authenticated creators may use available account controls to request a
          data export and to request voluntary account deletion. A voluntary
          deletion request enters a recovery period before eligible creator data
          is permanently purged. During that period, creator-product access is
          frozen while data-rights, security, billing-recovery, and reactivation
          controls remain available.
        </p>
        <p>
          Before requesting deletion, creators may choose to request an export
          before deletion or to skip that export. Export packages are temporary
          and may expire. Deletion does not require us to erase records that must
          or may lawfully be retained for security, fraud prevention, billing,
          dispute resolution, legal compliance, immutable audit evidence, or an
          active legal hold. A valid active legal hold blocks destructive
          deletion of material within its documented scope until the hold is
          released or expires.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">12. Termination</h2>
        <p>
          We reserve the right to suspend, restrict, or terminate your access to
          the service if we believe you have violated these Terms, our policies,
          applicable law, payment rules, or the safety of the platform or
          others, subject to any rights or notices required by applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">13. No Warranty</h2>
        <p>
          The service is provided as-is and as-available without warranties of
          any kind, whether express or implied. We do not guarantee that the
          service will be uninterrupted, secure, error-free, available at all
          times, compatible with every device, or that outputs will meet your
          expectations, be commercially usable, or comply with any legal
          standard.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">14. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Sirens Forge shall not be
          liable for indirect, incidental, special, consequential, exemplary, or
          punitive damages, including loss of data, revenue, reputation,
          business opportunity, account access, or generated content. In all
          cases, our total liability shall not exceed the amount you paid to
          Sirens Forge in the 12 months before the claim arose.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">15. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless Sirens Forge, its
          owners, operators, affiliates, contractors, payment processors, and
          service providers from and against any claims, damages, liabilities,
          losses, costs, and expenses arising from your use of the platform,
          your prompts, uploads, identity materials, generated content, violation
          of these Terms, violation of our policies, or violation of any rights
          of another person or entity.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">16. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Florida, without
          regard to conflict-of-law rules. Any disputes arising from these Terms
          or your use of the service shall be resolved exclusively in courts
          located in Florida, unless applicable law requires otherwise.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          17. Policy Versions and Material Changes
        </h2>
        <p>
          We may update these Terms or related policies. The current material
          policy bundle identifies the applicable Terms of Service, Privacy
          Policy, and Acceptable Use Policy by version and source evidence. When
          Sirens Forge marks a new material bundle as current, creator-product
          access may require active acceptance of that current bundle before
          protected creator features resume. Checkout acceptance and
          authenticated re-consent are recorded as durable policy-acceptance
          receipts.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">18. Contact</h2>
        <p>
          For questions regarding these Terms, please contact us at
          admin@sirensforge.vip.
        </p>
      </section>
    </LegalPageLayout>
  )
}
