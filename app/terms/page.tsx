import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      lastUpdated="April 11, 2026"
    >
      <section>
        <p>
          Welcome to Sirens Forge. By accessing or using our platform, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Eligibility</h2>
        <p>
          You must be at least 18 years old to use Sirens Forge. By using this service, you confirm that you are legally an adult in your jurisdiction and permitted to access adult-oriented content.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Account Responsibility</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account and for all activity that occurs under your account. You agree not to share access or allow unauthorized use.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Subscriptions and Billing</h2>
        <p>
          Sirens Forge operates on a subscription-based model. By subscribing, you agree to recurring billing through our payment provider. You may cancel at any time, but no refunds are guaranteed for unused time unless required by law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Use of the Service</h2>
        <p>
          You agree to use Sirens Forge only for lawful purposes and in accordance with our Acceptable Use Policy. You may not use the platform to generate, upload, or distribute content that violates applicable laws or the rights of others.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. AI-Generated Content</h2>
        <p>
          Sirens Forge provides AI-generated outputs based on user inputs. We do not guarantee the accuracy, legality, or appropriateness of generated content. You are solely responsible for how you use any generated content.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. User Content and Ownership</h2>
        <p>
          You retain ownership of the content you create using the platform. However, by using Sirens Forge, you grant us a limited license to process, store, and display your content solely for the purpose of operating the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Prohibited Conduct</h2>
        <p>
          You may not use Sirens Forge to create or distribute content involving minors, non-consensual acts, harassment, exploitation, or any illegal activity. Violations may result in immediate account termination.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your access to the service at any time, without notice, if you violate these terms or engage in harmful or abusive behavior.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
        <p>
          Sirens Forge is provided “as is” without warranties of any kind. We are not liable for any damages arising from your use of the service, including but not limited to loss of data, revenue, or reputation.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Changes to These Terms</h2>
        <p>
          We may update these Terms at any time. Continued use of the service after changes are posted constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Contact</h2>
        <p>
          For questions regarding these Terms, please contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}