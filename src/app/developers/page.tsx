import Link from "next/link";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import { Brand, Footer } from "@/components/ui";
export const metadata = { title: "Built in the open" };
export default function Developers() {
  return (
    <div className="docs-layout">
      <header className="docs-header">
        <Brand />
        <Link className="button secondary" href="/demo">
          Explore the demo <ArrowUpRight size={16} />
        </Link>
      </header>
      <main id="main" className="docs-content">
        <p className="eyebrow">SMALL SQUID. OPEN OCEAN.</p>
        <h1>
          A charging experience
          <br />
          you can call your own.
        </h1>
        <p>
          Squid is an open-source example of building a vacation-rental charging
          business on the Ivora API. It keeps the guest experience, host
          relationships, and payments in your application.
        </p>
        <h2>One small app. Connected.</h2>
        <ul>
          <li>
            <strong>Vercel + Next.js:</strong> the interface, server routes,
            payment webhook, and reconciliation job.
          </li>
          <li>
            <strong>Supabase:</strong> passwordless host sign-in, private
            property ownership, session records, and durable request identities.
          </li>
          <li>
            <strong>Resend:</strong> optional Squid-branded sign-in emails from
            your verified domain, with Supabase validating each one-use link.
          </li>
          <li>
            <strong>Stripe Connect:</strong> Squid’s own checkout, card
            authorizations, refunds, and host transfers. Squid receives a 6%
            application fee on the final charging amount.
          </li>
          <li>
            <strong>Ivora:</strong> OCPP charger registration, connection state,
            external-funded charging sessions, metered usage, and immutable
            energy bills. Squid never uses Ivora’s payment adapters.
          </li>
        </ul>
        <h2>Run it on your machine.</h2>
        <pre>
          <code>{`npm install\ncp .env.example .env\n# Add your own credentials to .env\nnpm run db:migrate\nnpm run dev`}</code>
        </pre>
        <p>
          No credentials yet? The landing page,{" "}
          <Link href="/demo">host demo</Link>, and{" "}
          <Link href="/c/demo">guest demo</Link> run independently. The demo
          doesn’t call Stripe or control a charger.
        </p>
        <h2>Give the database a home.</h2>
        <p>
          Create a Supabase project, enable email authentication, and run the
          files in <code>supabase/migrations</code> in filename order in its SQL
          editor. Alternatively, set <code>SUPABASE_DB_URL</code> and run the
          migration command above. Add your app’s <code>/auth/callback</code>{" "}
          and <code>/login/confirm</code> URLs to Supabase’s allowed redirect
          URLs.
        </p>
        <p>
          Host data has row-level security. The fleet key and service-role key
          stay on the server. Guest sessions use private, HTTP-only browser
          cookies.
        </p>
        <h2>A warm welcome, in their inbox.</h2>
        <p>
          Set <code>RESEND_API_KEY</code> and <code>RESEND_FROM_EMAIL</code> to
          send sign-in links from your verified domain. Squid generates the
          token with Supabase, sends its own branded email, and asks the
          recipient to confirm before signing in. Keep email link tracking
          disabled. The included database migration provides rate limits shared
          across Vercel instances.
        </p>
        <p>
          Without Resend, sign-in uses the email provider configured in
          Supabase. For either path, set your canonical app URL before inviting
          hosts.
        </p>
        <h2>Connect your own Stripe platform.</h2>
        <p>
          Enable Stripe Connect and use a test secret key while developing.
          Hosts complete Express onboarding. Checkout authorizes a $25 hold,
          then Squid captures the final metered amount with a 6% application
          fee. The unused hold is released. Stripe processing fees come from the
          platform’s share.
        </p>
        <pre>
          <code>{`stripe listen --forward-to localhost:3000/api/stripe/webhook\n# Save the printed whsec_ value as STRIPE_WEBHOOK_SECRET`}</code>
        </pre>
        <p>
          Listen for <code>checkout.session.completed</code> and{" "}
          <code>checkout.session.expired</code>. Webhook signatures are verified
          against the raw request body. Browser redirects are never treated as
          payment confirmation.
        </p>
        <h2>Make yourself at home on Vercel.</h2>
        <p>
          Import the repository as a Next.js project, add the environment
          variables listed in <code>.env.example</code>, and set{" "}
          <code>NEXT_PUBLIC_APP_URL</code> to your canonical HTTPS domain.
          Configure the Stripe webhook and Supabase redirects for that domain
          before printing QR stickers.
        </p>
        <p>
          The included job reconciles charging every minute, including when a
          guest closes their browser. A one-minute Vercel Cron schedule requires
          an eligible plan. You can also invoke the protected endpoint from your
          own scheduler:
        </p>
        <pre>
          <code>{`GET /api/cron/reconcile\nAuthorization: Bearer <CRON_SECRET>`}</code>
        </pre>
        <h2>A reference implementation, with clear boundaries.</h2>
        <p>
          The current Ivora endpoint is preproduction. Validate the complete
          flow with an explicitly designated test charger and Stripe test
          accounts before accepting real guest payments. Unknown charger or
          payment outcomes are held for review instead of creating a second
          transaction. Automatic cutoff requests use a margin below the
          authorization amount; delayed meter reports or an offline charger can
          still cause overages that need reconciliation.
        </p>
        <p>
          The repository includes setup, architecture, deployment, and
          contribution notes. Code is Apache-2.0 licensed. The included demo
          photograph retains its separate image license.
        </p>
        <div className="notice">
          Squid is designed for Airbnb and other vacation-rental hosts. It is
          not affiliated with or endorsed by Airbnb.
        </div>
        <Link href="/" className="text-link">
          <ArrowLeft size={15} /> Back to the good energy
        </Link>
      </main>
      <Footer />
    </div>
  );
}
