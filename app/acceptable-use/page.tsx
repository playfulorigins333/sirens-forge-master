import Link from "next/link"
import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function AcceptableUsePage() {
  return (
    <LegalPageLayout title="Acceptable Use Policy" lastUpdated="August 22, 2026">
      <section>
        <p>
          This Acceptable Use Policy defines the rules and restrictions for using
          Sirens Forge. By using the platform, you agree to comply with this
          policy, our Terms of Service, and all other platform rules we publish.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">1. Adult-Only Platform</h2>
        <p>
          Sirens Forge is strictly for adults aged 18 and older. You may not use
          the platform if you are under 18 or if adult-oriented content is
          prohibited in your jurisdiction.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          2. Minors and Underage-Looking Content
        </h2>
        <p>
          You may not create, upload, request, generate, store, distribute, or
          promote any content that depicts, suggests, sexualizes, or appears to
          involve minors. This includes real, fictional, AI-generated, animated,
          stylized, cartoon, fantasy, roleplay, or ambiguous underage-looking
          characters. Violations may result in immediate account termination and
          reporting where appropriate or legally required.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          3. Non-Consensual and Exploitative Content
        </h2>
        <p>
          You may not create, request, upload, generate, store, distribute, or
          promote content involving non-consensual sexual activity, coercion,
          exploitation, abuse, trafficking, blackmail, forced scenarios,
          intoxication-based incapacity, unconsciousness, or sexual violence.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          4. Real Person, Identity, and Deepfake Restrictions
        </h2>
        <p>
          You may not create, request, upload, generate, store, distribute, or
          promote nonconsensual intimate imagery or an unauthorized intimate
          depiction of an identifiable real person. This includes AI-generated
          or AI-altered sexual deepfakes and face swaps made without appropriate
          consent and authorization, revenge content, unauthorized likeness use,
          or attempts to deceive others about a real person&apos;s identity, consent,
          or participation.
        </p>
        <p>
          This restriction does not blanket-prohibit a creator&apos;s consensual,
          authorized Twin or a fully synthetic fictional persona that is not an
          identifiable real person. Users remain responsible for all necessary
          rights and consent.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          5. Harassment, Abuse, and Harmful Use
        </h2>
        <p>
          You may not use the platform to harass, threaten, intimidate,
          humiliate, shame, stalk, blackmail, extort, dox, defame, or otherwise
          harm another person or group. This includes generating content intended
          to cause emotional distress, reputational damage, or targeted abuse.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Illegal Activities</h2>
        <p>
          You may not use Sirens Forge to engage in, support, enable, conceal,
          or promote illegal activity. This includes fraud, exploitation,
          trafficking, identity theft, unauthorized access, extortion, unlawful
          distribution of intimate content, or any other unlawful behavior.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Intellectual Property and Privacy Violations
        </h2>
        <p>
          You may not upload, reference, generate, or distribute content that
          infringes copyrights, trademarks, publicity rights, privacy rights,
          contractual rights, or other rights belonging to another person or
          entity. You are responsible for having all rights, permissions, and
          consents required for anything you submit or create.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Platform Abuse</h2>
        <p>
          You may not abuse, exploit, reverse engineer, scrape, overload,
          interfere with, bypass safeguards, automate excessive usage, resell
          access without authorization, compromise security, or attempt to
          disrupt Sirens Forge or its infrastructure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Content Responsibility</h2>
        <p>
          You are fully responsible for all prompts, uploads, references,
          identity materials, LoRA materials, account activity, generated
          outputs, downloads, publications, sales, and distributions connected
          to your use of Sirens Forge. Sirens Forge does not guarantee the
          legality, safety, originality, appropriateness, or commercial usability
          of user-generated outputs.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          10. Monitoring, Logging, and Review
        </h2>
        <p>
          Automated safety and service processing does not imply casual human
          browsing of private creator content. Human access is purpose-limited
          to legitimate support or technical troubleshooting, safety or NCII
          investigation, fraud or security investigation, policy enforcement,
          or a legal requirement. We may preserve or remove material where
          supported by those purposes.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Enforcement Actions</h2>
        <p>
          We may remove content, reject prompts, restrict features, freeze
          outputs, suspend accounts, permanently ban users, cancel access,
          preserve evidence, block payments, deny refunds, or take other action
          at our sole discretion if we believe this policy, our Terms, payment
          rules, safety rules, or applicable law has been violated.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">12. Reporting and Complaints</h2>
        <p>
          Users and third parties may contact us to report suspected abuse,
          rights violations, unauthorized likeness use, prohibited content,
          privacy violations, or other policy concerns. We may request additional
          information to evaluate a report and may take action where appropriate
          or legally required.
        </p>
        <p>
          To report nonconsensual intimate content or an unauthorized intimate
          deepfake, use the public <Link className="text-cyan-400 hover:underline" href="/report-intimate-content">Report Nonconsensual Intimate Content / Request Removal</Link> page. No account is required.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">13. Law Enforcement Cooperation</h2>
        <p>
          Sirens Forge may cooperate with law enforcement authorities, payment
          processors, hosting providers, legal advisors, and safety organizations
          where required or appropriate. This may include reporting prohibited
          activity, preserving records, removing content, restricting access, or
          providing information in response to valid legal process.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">14. Updates to This Policy</h2>
        <p>
          We may update this policy. We will post the updated version and date
          and provide additional notice or obtain acceptance when required.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">15. Contact</h2>
        <p>
          If you have questions about this policy or need to report a concern,
          contact us at admin@sirensforge.vip.
        </p>
      </section>
    </LegalPageLayout>
  )
}
