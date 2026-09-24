import Link from "next/link";
import { Brand } from "@/components/ui";
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
          Squid’s application fee is 6% of the final transaction amount, rounded
          to the nearest cent. The remaining 94% is transferred to the host’s
          connected Stripe account. Bank payouts follow Stripe’s account
          requirements and payout schedule. A full refund reverses the host
          transfer and the application fee.
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
