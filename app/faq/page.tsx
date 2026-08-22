import Link from "next/link"
import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function FAQPage() {
  return (
    <LegalPageLayout
      title="Frequently Asked Questions"
      lastUpdated="August 21, 2026"
    >
      <section>
        <h2 className="text-xl font-semibold">1. What is Sirens Forge?</h2>
        <p>
          Sirens Forge is an identity-first AI creation platform centered on reusable AI Twin identities and creator workflows.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Do I need an AI Twin identity to generate?</h2>
        <p>
          No. You can generate images without training or selecting an AI Twin. If you want a reusable character or consistent identity across generations, you can create and select an AI Twin identity.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. What is an AI Twin identity?</h2>
        <p>
          An AI Twin identity is an optional custom-trained AI model (LoRA) that represents a specific character or persona. You can reuse it across generations when you want consistent identity features.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. What can I create?</h2>
        <p>
          Sirens Forge supports prompt-driven image creation with optional identity-anchored workflows using an AI Twin or the Siren’s Mind assistant. Image generation availability is shown in the generator. Video generation is Coming Soon.
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
          The OG Founder offer is $1,333 one-time with lifetime founder access and no recurring subscription. Early Bird is $29.99/month while the subscription remains active.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Can I cancel anytime?</h2>
        <p>
          Early Bird is a recurring plan that you can manage or cancel through your account and billing controls. Access continues until the end of the active billing period. OG Founder is a one-time purchase, so there is no recurring subscription to cancel.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Is my content private?</h2>
        <p>
          Creator content is processed to provide requested features and for limited support, security, safety, compliance, and legal purposes. Private creator material is not used for generalized model training by default, and any future such use requires separate explicit opt-in. No online service can promise absolute confidentiality or security; see our <Link className="text-cyan-400 hover:underline" href="/privacy">Privacy Policy</Link>.
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
          For support, contact us at admin@sirensforge.vip.
        </p>
      </section>
    </LegalPageLayout>
  )
}
