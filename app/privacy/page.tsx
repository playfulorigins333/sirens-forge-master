import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated="April 11, 2026"
    >
      <section>
        <p>
          This Privacy Policy explains how Sirens Forge collects, uses, and protects your information when you use our platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p>
          We may collect the following types of information:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Account information such as email address and authentication details</li>
          <li>Billing information processed through our payment provider</li>
          <li>Prompts, inputs, and generated content</li>
          <li>Usage data including interactions, logs, and system activity</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
        <p>
          We use your information to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Operate and maintain the Sirens Forge platform</li>
          <li>Process subscriptions and payments</li>
          <li>Generate and store user-requested outputs</li>
          <li>Improve system performance and user experience</li>
          <li>Detect and prevent abuse or violations of our policies</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. AI-Generated Content and Prompts</h2>
        <p>
          Prompts and generated outputs may be stored and processed to provide the service. We do not guarantee that generated content is private or confidential, and users should avoid submitting sensitive personal information.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Payment Processing</h2>
        <p>
          Payments are processed through third-party providers such as Stripe. We do not store full payment details such as credit card numbers. Payment providers handle billing information according to their own privacy policies.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Data Storage and Security</h2>
        <p>
          We store data using secure infrastructure and take reasonable measures to protect your information. However, no system can be guaranteed to be completely secure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Third-Party Services</h2>
        <p>
          Sirens Forge may use third-party services for hosting, storage, analytics, and AI processing. These services may process data as required to provide functionality.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Data Retention</h2>
        <p>
          We retain data for as long as necessary to operate the platform, comply with legal obligations, and resolve disputes. We may delete or anonymize data at our discretion.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Your Responsibilities</h2>
        <p>
          You are responsible for ensuring that any content you submit does not include sensitive or personal information that you do not wish to be stored or processed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy at any time. Continued use of the platform after changes are posted constitutes acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p>
          For questions about this Privacy Policy, contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}