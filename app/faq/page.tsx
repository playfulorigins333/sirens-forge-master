import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function FAQPage() {
  return (
    <LegalPageLayout
      title="Frequently Asked Questions"
      lastUpdated="April 11, 2026"
    >
      <section>
        <h2 className="text-xl font-semibold">1. What is Sirens Forge?</h2>
        <p>
          Sirens Forge is an identity-first AI generation platform that allows you to create images, videos, and guided creative content using advanced AI tools.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Do I need an identity (LoRA) to generate?</h2>
        <p>
          No. You can generate content immediately without creating an identity. Identities are optional and allow for more consistent, personalized results across generations.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. What is an identity?</h2>
        <p>
          An identity is a custom-trained AI model (LoRA) that represents a specific character or persona. Once created, it can be reused across images and videos to maintain consistency.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. What can I create?</h2>
        <p>
          You can create AI-generated images, videos, and guided creative outputs using prompts or the Siren’s Mind assistant.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. What is Siren’s Mind?</h2>
        <p>
          Siren’s Mind is an AI-powered assistant that helps you craft prompts, refine ideas, and guide your creations before sending them to the generator.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. How does billing work?</h2>
        <p>
          Sirens Forge operates on a subscription model. You are billed on a recurring basis through our payment provider. You can cancel your subscription at any time.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Can I cancel anytime?</h2>
        <p>
          Yes. You can cancel your subscription at any time through your account settings. Access will continue until the end of your billing period.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Is my content private?</h2>
        <p>
          Your content is stored and processed to provide the service. However, you should avoid submitting sensitive or personal information. See our Privacy Policy for more details.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. What content is not allowed?</h2>
        <p>
          You may not create content involving minors, non-consensual acts, real-person exploitation, or illegal activity. See our Acceptable Use Policy for full details.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. What happens if I violate the rules?</h2>
        <p>
          Violations may result in content removal, account suspension, or permanent bans depending on severity.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Who do I contact for help?</h2>
        <p>
          For support, contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}