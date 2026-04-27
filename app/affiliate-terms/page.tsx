import LegalPageLayout from "@/components/legal/LegalPageLayout"

export default function AffiliateTermsPage() {
  return (
    <LegalPageLayout
      title="Affiliate Terms and Conditions"
      lastUpdated="April 27, 2026"
    >
      <section>
        <p>
          These Affiliate Terms and Conditions govern participation in the
          Sirens Forge affiliate program. By participating, you agree to these
          terms in full.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          1. Program Overview
        </h2>
        <p>
          The Sirens Forge affiliate program allows approved participants to
          earn commissions by referring new users to the platform using a unique
          referral link or tracking method provided by Sirens Forge.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          2. Eligibility and Approval
        </h2>
        <p>
          Participation in the affiliate program is subject to approval at the
          sole discretion of Sirens Forge. We reserve the right to accept, deny,
          or revoke participation at any time, for any reason.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          3. Commission Structure
        </h2>
        <p>
          Commission rates, structures, durations, and eligibility are determined
          by Sirens Forge and may vary by program, promotion, or user tier.
        </p>
        <p>
          Commissions are earned only on qualifying transactions that are
          successfully tracked and completed through your referral link.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          4. Tracking and Attribution
        </h2>
        <p>
          Referral tracking is based on our internal systems, which may include
          cookies, tracking links, and account attribution. Sirens Forge is not
          responsible for tracking failures due to technical issues, user
          behavior, or third-party interference.
        </p>
        <p>
          Final determination of referral attribution is at the sole discretion
          of Sirens Forge.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          5. Payment Terms
        </h2>
        <p>
          Commissions are paid only after qualifying transactions are completed
          and verified. Payments may be subject to minimum thresholds, holding
          periods, or verification requirements.
        </p>
        <p>
          Sirens Forge reserves the right to delay, withhold, or cancel payments
          in cases of suspected fraud, abuse, chargebacks, refunds, or policy
          violations.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          6. Prohibited Affiliate Conduct
        </h2>
        <p>
          Affiliates may not:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Engage in spam, unsolicited messaging, or misleading promotion</li>
          <li>Misrepresent Sirens Forge or its services</li>
          <li>Use deceptive, fraudulent, or unethical practices</li>
          <li>Self-refer or attempt to generate commissions on their own accounts</li>
          <li>Use paid ads, brand bidding, or impersonation without authorization</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          7. Termination of Participation
        </h2>
        <p>
          Sirens Forge may suspend or terminate your affiliate participation at
          any time, with or without notice, if you violate these terms or engage
          in conduct that harms the platform or its users.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          8. Modification of Program
        </h2>
        <p>
          Sirens Forge reserves the right to modify, suspend, or terminate the
          affiliate program, including commission rates and structures, at any
          time without prior notice.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          9. No Guarantee of Earnings
        </h2>
        <p>
          Participation in the affiliate program does not guarantee income or
          earnings of any kind. Results will vary based on individual effort,
          promotion methods, and external factors.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          10. Limitation of Liability
        </h2>
        <p>
          Sirens Forge shall not be liable for any indirect, incidental, or
          consequential damages arising from participation in the affiliate
          program. Total liability shall not exceed commissions earned and
          payable.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          11. Governing Law
        </h2>
        <p>
          These Affiliate Terms are governed by the laws of the State of Florida.
          Any disputes shall be resolved in Florida.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">
          12. Contact
        </h2>
        <p>
          For questions regarding the affiliate program, contact us at
          admin@sirensforge.com.
        </p>
      </section>
    </LegalPageLayout>
  )
}