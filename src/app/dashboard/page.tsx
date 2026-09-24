import { redirect } from "next/navigation";
import Link from "next/link";
import { Dashboard } from "@/components/dashboard";
import { Brand } from "@/components/ui";
import { db, user } from "@/lib/server/db";
import { supabaseConfigured } from "@/lib/server/config";
import { payoutStatus } from "@/lib/server/stripe";
import { getStation } from "@/lib/server/ivora";
import { chargerStatus, type ChargerStatus } from "@/lib/status";
import type { HostSession, Property } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  if (!supabaseConfigured()) redirect("/login");
  const host = await user();
  if (!host) redirect("/login");
  const [properties, sessions] = await Promise.all([
    db()
      .from("squid_properties")
      .select("*")
      .eq("host_id", host.id)
      .order("created_at"),
    db()
      .from("squid_sessions")
      .select(
        "id,property_id,status,rate_cents,energy_kwh,total_cents,fee_cents,stripe_fee_cents,created_at,started_at,ended_at",
      )
      .eq("host_id", host.id)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (properties.error || sessions.error)
    return (
      <main id="main" className="setup-page">
        <Brand />
        <h1>Your workspace is almost ready.</h1>
        <p>
          The Squid database tables need to be installed. Run the included SQL
          migration in your Supabase project, then refresh this page.
        </p>
        <code>npm run db:migrate</code>
        <Link className="button primary" href="/developers">
          Open the setup guide
        </Link>
        <Link href="/demo" className="text-link">
          Explore the demo in the meantime →
        </Link>
      </main>
    );
  const [account, status] = await Promise.all([
    payoutStatus(host.id).catch(() => ({ ready: false, id: undefined })),
    Promise.all(
      (properties.data as Property[]).map(
        async (p): Promise<[string, ChargerStatus]> => [
          p.id,
          await stationStatus(p.station_id),
        ],
      ),
    ).then(Object.fromEntries<ChargerStatus>),
  ]);
  return (
    <Dashboard
      initial={{
        properties: properties.data as Property[],
        sessions: sessions.data as HostSession[],
        email: host.email ?? "Host",
        payoutsReady: account.ready,
        stripeConnected: Boolean(account.id),
        status,
      }}
    />
  );
}
// One slow Ivora lookup must not stall the whole dashboard; give up after 4s.
async function stationStatus(stationId: number | null): Promise<ChargerStatus> {
  if (!stationId) return "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const station = await Promise.race([
    getStation(stationId),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 4000);
    }),
  ])
    .catch(() => null)
    .finally(() => clearTimeout(timer));
  return chargerStatus(station);
}
