import Link from "next/link";
import type { Metadata } from "next";
import { Brand } from "@/components/ui";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};
// Opening this page changes nothing; only the button below unsubscribes, so
// email security scanners that prefetch links cannot unsubscribe a host.
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; done?: string | string[] }>;
}) {
  const { t, done } = await searchParams;
  const token = typeof t === "string" && t.length <= 200 ? t : "";
  if (done === "1")
    return (
      <main id="main" className="setup-page">
        <Brand />
        <h1>You’re unsubscribed.</h1>
        <p>
          You won’t receive the Squid host newsletter anymore. Account and
          charging emails are not affected. You can turn the newsletter back on
          at any time in Settings.
        </p>
        <Link className="button primary" href="/dashboard?tab=settings">
          Open Settings →
        </Link>
      </main>
    );
  if (!token)
    return (
      <main id="main" className="setup-page">
        <Brand />
        <h1>Manage your newsletter.</h1>
        <p>
          This link doesn’t belong to a newsletter email. Sign in and turn the
          Squid host newsletter on or off in Settings.
        </p>
        <Link className="button primary" href="/dashboard?tab=settings">
          Open Settings →
        </Link>
      </main>
    );
  return (
    <main id="main" className="setup-page">
      <Brand />
      <h1>Unsubscribe from the host newsletter?</h1>
      <p>
        You’ll stop receiving the weekly Squid host newsletter. Account and
        charging emails are not affected.
      </p>
      <form
        method="post"
        action={`/api/newsletter/unsubscribe?${new URLSearchParams({ t: token })}`}
      >
        <input type="hidden" name="List-Unsubscribe" value="One-Click" />
        <button className="button primary">Unsubscribe</button>
      </form>
    </main>
  );
}
