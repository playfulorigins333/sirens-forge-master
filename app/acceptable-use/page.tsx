import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function AcceptableUsePage() {
  return (
    <LegalPageLayout
      title="Acceptable Use Policy"
      lastUpdated="April 11, 2026"
    >
      <section>
        <p>
          This Acceptable Use Policy defines the rules and restrictions for using Sirens Forge. By using the platform, you agree to comply with all terms outlined below.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Age Restriction</h2>
        <p>
          Sirens Forge is strictly for adults aged 18 and older. You may not use the platform if you are under 18. Any content that depicts or suggests minors is strictly prohibited.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Prohibited Content Involving Minors</h2>
        <p>
          You may not create, upload, request, or distribute any content that depicts minors in any sexual or suggestive manner. This includes fictional, AI-generated, stylized, or ambiguous representations. Any violation will result in immediate account termination and may be reported to appropriate authorities.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Non-Consensual and Exploitative Content</h2>
        <p>
          You may not create or distribute content that depicts non-consensual acts, coercion, exploitation, abuse, or violence in a sexual context. This includes rape scenarios, forced situations, or any content that removes or ignores consent.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Real Person and Deepfake Restrictions</h2>
        <p>
          You may not use Sirens Forge to generate or manipulate content involving real individuals without their explicit consent. This includes deepfakes, impersonation, or generating likenesses of real people in explicit or misleading contexts.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Harassment, Abuse, and Harmful Use</h2>
        <p>
          You may not use the platform to harass, threaten, intimidate, or harm others. This includes generating content intended for blackmail, humiliation, or emotional distress.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Illegal Activities</h2>
        <p>
          You may not use Sirens Forge to engage in or promote illegal activities. This includes generating content intended to support fraud, exploitation, trafficking, or any unlawful behavior.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Platform Abuse</h2>
        <p>
          You may not attempt to abuse, exploit, or disrupt the platform. This includes attempting to bypass safeguards, reverse engineer systems, overload infrastructure, or automate excessive usage in a way that harms the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Content Responsibility</h2>
        <p>
          You are fully responsible for all content you generate, upload, or distribute using Sirens Forge. The platform does not review or guarantee the legality or appropriateness of user-generated outputs.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Enforcement</h2>
        <p>
          We reserve the right to remove content, suspend accounts, or permanently ban users at our sole discretion if violations occur. Serious violations may be reported to law enforcement authorities where required.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Updates to This Policy</h2>
        <p>
          This policy may be updated at any time. Continued use of the platform constitutes acceptance of the latest version.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Contact</h2>
        <p>
          If you have questions about this policy, contact us at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}