import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function UnderagePolicyPage() {
  return (
    <LegalPageLayout title="Underage Content Policy" lastUpdated="April 27, 2026">
      <section>
        <p>
          Sirens Forge maintains a strict zero-tolerance policy for any content
          involving minors. This policy applies to all users, content, prompts,
          uploads, identity inputs, and generated outputs.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Strict Age Requirement</h2>
        <p>
          Sirens Forge is an adult-only platform. All users must be at least 18
          years old. Any use of the platform by a minor is strictly prohibited
          and may result in immediate account termination.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          2. Prohibited Underage Content
        </h2>
        <p>
          You may not create, request, upload, generate, store, or distribute any
          content that depicts, suggests, or appears to involve minors in any
          sexual, suggestive, or exploitative context.
        </p>
        <p>
          This includes, but is not limited to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Real minors</li>
          <li>AI-generated minors</li>
          <li>Fictional or animated characters that appear underage</li>
          <li>Cartoon, anime, or stylized characters that resemble minors</li>
          <li>“Age-play” or roleplay scenarios involving minors</li>
          <li>Ambiguous age representations that could reasonably be interpreted as underage</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          3. Ambiguous or Borderline Content
        </h2>
        <p>
          Content that appears youthful, childlike, or ambiguous in age may be
          treated as underage content at our sole discretion. Sirens Forge
          reserves the right to remove, block, or restrict such content even if
          intent is disputed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          4. User Responsibility
        </h2>
        <p>
          Users are solely responsible for ensuring that all prompts, uploads,
          identity references, and generated content comply with this policy.
          Sirens Forge does not verify age, consent, or identity ownership of
          submitted materials.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          5. Enforcement Actions
        </h2>
        <p>
          Violations of this policy may result in immediate and permanent account
          termination without notice. Sirens Forge may remove content, restrict
          access, preserve records, and take any action deemed necessary to
          protect the platform and comply with legal obligations.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. Reporting and Cooperation
        </h2>
        <p>
          Sirens Forge may report violations to appropriate authorities and
          cooperate with law enforcement where required or appropriate. This may
          include sharing relevant data, preserving evidence, and responding to
          legal requests.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Zero Tolerance
        </h2>
        <p>
          There are no exceptions to this policy. Any violation, regardless of
          intent, may result in immediate enforcement action.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Contact</h2>
        <p>
          If you become aware of content that may violate this policy, contact us
          immediately at admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}