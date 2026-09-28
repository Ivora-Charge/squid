import Link from "next/link";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import { Brand, Footer } from "@/components/ui";
import { ChargerTable } from "./charger-table";
export const metadata = { title: "Connect your charger" };
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
        <p className="eyebrow">PLUG IN. WELCOME IN.</p>
        <h1>
          Connect your charger
          <br />
          in three simple steps.
        </h1>
        <p>
          Squid works with smart chargers — the kind that connect to the
          internet over Wi-Fi or a network cable. If yours is on the list below,
          you can have it welcoming guests in about fifteen minutes. No
          technical background needed.
        </p>
        <h2>Will my charger work?</h2>
        <p>
          These brands and models work with Squid. Search for yours — each one
          links to a short guide showing where its connection settings live.
        </p>
        <ChargerTable />
        <p>
          Not on the list? If your charger’s app or settings page has a section
          called <strong>OCPP</strong> (the standard language smart chargers use
          to talk to platforms like Squid), it will very likely work too. When
          in doubt, ask your installer or the charger’s manufacturer.
        </p>
        <h2>Three steps to good energy.</h2>
        <ol>
          <li>
            <strong>Add your property in Squid.</strong> Sign in, add your
            property, and Squid shows you three values made for your charger: a
            station ID, a connection address, and a password.
          </li>
          <li>
            <strong>Paste them into your charger’s settings.</strong> Open your
            charger’s app or settings page — the guide linked in the table shows
            exactly where. Find the section called OCPP (sometimes “server” or
            “backend”), paste the three values, choose <strong>OCPP 1.6</strong>{" "}
            if it asks, and restart the charger.
          </li>
          <li>
            <strong>Come back to Squid and refresh.</strong> When your charger
            shows <strong>online</strong>, connect your payout account, print
            your QR sticker, and you’re ready for guests.
          </li>
        </ol>
        <p>
          Your charger only needs a working internet connection — there’s
          nothing to configure on your router. If it doesn’t come online after a
          restart, double-check the three values for typos; that’s the cause
          nine times out of ten.
        </p>
        <div className="notice">
          Squid is designed for Airbnb and other vacation-rental hosts. It is
          not affiliated with or endorsed by Airbnb.
        </div>
        <p>
          Curious how Squid works under the hood? It’s open source — the code
          and technical documentation live{" "}
          <a
            href="https://github.com/Ivora-Charge/squid"
            target="_blank"
            rel="noreferrer"
          >
            on GitHub
          </a>
          .
        </p>
        <Link href="/" className="text-link">
          <ArrowLeft size={15} /> Back to the good energy
        </Link>
      </main>
      <Footer />
    </div>
  );
}
