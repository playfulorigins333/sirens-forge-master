import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function BlockedContentPage() {
  return (
    <LegalPageLayout title="Blocked Content Policy" lastUpdated="April 27, 2026">
      <section>
        <p>
          This Blocked Content Policy defines categories of content that are
          strictly prohibited on Sirens Forge. These restrictions apply to all
          prompts, uploads, identity inputs, LoRA materials, generated outputs,
          and any use of the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Content Involving Minors</h2>
        <p>
          Any content that depicts, suggests, or appears to involve minors in a
          sexual, suggestive, or exploitative context is strictly prohibited.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Real minors</li>
          <li>AI-generated minors</li>
          <li>Fictional or animated underage characters</li>
          <li>Cartoon, anime, or stylized minor-like figures</li>
          <li>Age-play or underage roleplay scenarios</li>
          <li>Ambiguous youthful or childlike representations</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          2. Non-Consensual and Exploitative Content
        </h2>
        <p>
          Content involving lack of consent or exploitation is prohibited,
          including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Rape or forced scenarios</li>
          <li>Coercion or manipulation</li>
          <li>Blackmail or extortion-based content</li>
          <li>Sexual violence or abuse</li>
          <li>Intoxication or unconsciousness exploitation</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          3. Unauthorized Real Person Content
        </h2>
        <p>
          You may not generate or manipulate content involving real individuals
          without their explicit consent.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Deepfakes or face swaps</li>
          <li>Celebrity impersonation</li>
          <li>Private individual exploitation</li>
          <li>Non-consensual intimate imagery</li>
          <li>Misleading identity representations</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          4. Harassment and Harmful Content
        </h2>
        <p>
          Content intended to harm others is prohibited, including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Harassment or bullying</li>
          <li>Threats or intimidation</li>
          <li>Defamation or reputational harm</li>
          <li>Content intended to shame or humiliate</li>
          <li>Blackmail or coercive content</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Illegal Activity</h2>
        <p>
          Content that promotes or enables illegal activity is prohibited,
          including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Fraud or scams</li>
          <li>Identity theft</li>
          <li>Trafficking or exploitation</li>
          <li>Unauthorized access or hacking</li>
          <li>Distribution of illegal materials</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. Intellectual Property Violations
        </h2>
        <p>
          Content that infringes on intellectual property rights is prohibited,
          including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Copyright infringement</li>
          <li>Trademark misuse</li>
          <li>Unauthorized use of protected works</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Platform Abuse and Exploitation
        </h2>
        <p>
          Actions that abuse the platform are prohibited, including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Bypassing safeguards or filters</li>
          <li>Automating excessive usage</li>
          <li>Scraping or extracting data</li>
          <li>Reverse engineering systems</li>
          <li>Reselling access without authorization</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          8. Enforcement
        </h2>
        <p>
          Sirens Forge may remove content, restrict access, suspend accounts,
          terminate users, preserve data, or take any action deemed necessary if
          this policy is violated.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          9. No Exhaustive List
        </h2>
        <p>
          This list is not exhaustive. Sirens Forge reserves the right to
          restrict or remove any content that it determines to be harmful,
          unsafe, abusive, or inconsistent with platform standards, even if not
          explicitly listed above.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p>
          For questions or reports regarding blocked content, contact us at
          admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}