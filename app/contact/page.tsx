import LegalPageLayout from "@/components/legal/LegalPageLayout";

export default function ContactPage() {
  return (
    <LegalPageLayout title="Contact" lastUpdated="April 27, 2026">
      <section>
        <p>
          If you need support, have questions, or need to submit a request,
          please contact us using the information below.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Email</h2>
        <p className="mt-2">
          <a
            href="mailto:admin@sirensforge.com"
            className="text-cyan-400 hover:underline"
          >
            admin@sirensforge.com
          </a>
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Response Time</h2>
        <p className="mt-2">
          We aim to respond to all inquiries within a reasonable timeframe.
          Response times may vary depending on the nature of the request.
        </p>
      </section>
    </LegalPageLayout>
  );
}