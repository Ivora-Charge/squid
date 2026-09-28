import Link from "next/link";
import { Brand } from "@/components/ui";
export default function Privacy() {
  return (
    <div className="docs-layout">
      <header className="docs-header">
        <Brand />
        <Link href="/">Back to Squid</Link>
      </header>
      <main id="main" className="docs-content">
        <p className="eyebrow">YOUR DATA, WITH CARE</p>
        <h1>
          A little data.
          <br />A clear purpose.
        </h1>
        <p>
          This notice describes the data handled by the Squid reference
          application. Operators must add their contact details, retention
          periods, and applicable privacy terms before launching their own
          instance.
        </p>
        <h2>For hosts</h2>
        <p>
          Supabase stores your sign-in email, property details, charger
          ownership, and session references. Stripe handles connected-account
          onboarding and payment details. Squid stores your connected account’s
          identifier, not bank account or identity-verification documents.
          Supabase manages password authentication. When you choose Google
          sign-in, Google shares your account identity, email, and basic profile
          with Supabase. When enabled, Resend delivers confirmation, recovery,
          and sign-in emails. Squid stores keyed digests of email and source
          addresses to limit repeated requests.
        </p>
        <h2>Property address and charger setup</h2>
        <p>
          When you search for a property address, Google Maps receives the
          address text you enter and returns suggestions and location details.
          Squid saves your selected property address and location for charger
          setup. Google handles these requests under its{" "}
          <a href="https://policies.google.com/privacy">Privacy Policy</a>.
          Charger connection passwords are stored encrypted and shown only to
          the owning host.
        </p>
        <h2>For guests</h2>
        <p>
          You do not need a Squid account. An HTTP-only cookie gives your
          browser private access to your charging session. Squid stores energy
          use, charging times, payment references, and the final amount. Card
          details are collected by Stripe and do not pass through Squid’s
          servers.
        </p>
        <h2>Service providers</h2>
        <p>
          A typical deployment uses Vercel to host the application, Supabase for
          authentication and data, Google for address lookup and optional
          sign-in, Resend for account emails, Stripe for payments, and Ivora for
          charger control and metering. Ivora receives non-secret payment
          references, not your card details or Stripe credentials.
        </p>
        <h2>Analytics</h2>
        <p>
          When the operator enables them, PostHog and Google Analytics measure
          how the site is used: pages visited, buttons pressed, device and
          browser type, and approximate location. PostHog may also record
          sessions to help us fix problems; everything typed into forms is
          hidden from those recordings, and charger passwords are never
          recorded. Sign-in and password-reset links are not sent to either
          service. Card details are entered on Stripe’s own page and are never
          seen by analytics. PostHog and Google handle this data under their own
          privacy policies: <a href="https://posthog.com/privacy">PostHog</a>{" "}
          and <a href="https://policies.google.com/privacy">Google</a>.
        </p>
        <h2>The demo</h2>
        <p>
          Demo chargers are saved only in your browser’s local storage. You can
          clear site data in your browser to reset the demo. Squid includes no
          advertising trackers.
        </p>
      </main>
    </div>
  );
}
