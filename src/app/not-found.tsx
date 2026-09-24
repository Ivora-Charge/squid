import Link from "next/link";
import { Brand } from "@/components/ui";
export default function NotFound() {
  return (
    <main id="main" className="setup-page">
      <Brand />
      <h1>This little corner is off the grid.</h1>
      <p>
        The charger may be unpublished, or the link may have changed. Check with
        your host or head back to Squid.
      </p>
      <Link className="button primary" href="/">
        Back to Squid →
      </Link>
    </main>
  );
}
