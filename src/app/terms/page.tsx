import Link from "next/link";
import { Brand } from "@/components/ui";
// Version 2 raised Squid's fee for new hosts from 6% to 10%. The operator must
// keep EFFECTIVE_DATE in step with the date the fee migration is applied.
const TERMS_VERSION = 2;
const EFFECTIVE_DATE = "November 1, 2026";
export default function Terms() {
  return (
    <div className="docs-layout">
      <header className="docs-header">
        <Brand />
        <Link href="/">Back to Squid</Link>
      </header>
      <main id="main" className="docs-content">
        <p className="eyebrow">THE SMALL PRINT</p>
        <h1>Charging, with clarity.</h1>
        <p className="fine-print">
          Version {TERMS_VERSION} · Effective {EFFECTIVE_DATE}
        </p>
        <p>
          This is the Squid reference application. The demo is a simulation and
          never collects a payment. A deployed instance is operated by the party
          hosting that instance, who must publish their business identity,
          support details, and applicable terms before offering a live service.
        </p>
        <h2>Your charging cost</h2>
        <p>
          The guest page shows the price per kWh before you start. A temporary
          card authorization reserves funds; your final charge is based on
          measured energy. The unused part of the authorization is released. The
          timing of that release appearing on your account depends on your bank.
          Charges below $0.50 are waived and the full authorization is released.
        </p>
        <h2>Ending a session</h2>
        <p>
          You can request a stop from your session page. Charging is finished
          only when the charger confirms it. Keep the session page open or
          bookmarked in the browser you used to start it. Contact your host if
          you lose access or the charger does not respond.
        </p>
        <h2>Host earnings</h2>
        <p>
          Squid’s fee is a percentage of the final transaction amount, rounded
          half up to the nearest cent. Hosts whose Squid account is created on
          or after {EFFECTIVE_DATE} pay 10%. Hosts whose account existed before
          that date keep their 6% fee. Each charging session uses its host’s
          rate at the time the guest starts checkout, and that rate also applies
          to any refund of that session. Each host’s dashboard shows their own
          rate. Stripe’s card processing fee (currently 2.9% plus $0.30 per
          transaction for standard US cards) is charged directly to the host’s
          connected Stripe account. The charging payment is made on that
          account, and Squid receives its fee separately. Bank payouts follow
          Stripe’s account requirements and payout schedule. A full refund also
          returns Squid’s fee; Stripe’s original processing fee may not be
          returned.
        </p>
        <p>
          Version 1 of these terms applied a 6% fee to every host. It continues
          to apply to sessions started before {EFFECTIVE_DATE}.
        </p>
        <h2>Address search</h2>
        <p>
          Property address search uses Google Maps. Use of that feature is
          subject to the{" "}
          <a href="https://maps.google.com/help/terms_maps/">
            Google Maps Terms of Service
          </a>
          .
        </p>
        <h2>Compatibility and support</h2>
        <p>
          Check that the connector is suitable for your vehicle and follow the
          charger manufacturer’s instructions. A listed maximum charging power
          is not a guarantee of the power your vehicle will receive. The
          property host is your first point of contact for access or charger
          assistance.
        </p>
      </main>
    </div>
  );
}
