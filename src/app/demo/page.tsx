import { Dashboard } from "@/components/dashboard";
import { demoDashboard } from "@/lib/demo";
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string; review?: string }>;
}) {
  const initial = demoDashboard();
  const params = await searchParams;
  // ?review=1 previews how a session that needs the host's review is listed.
  if (params.review === "1")
    initial.sessions.unshift({
      id: "SQ-2100",
      property_id: initial.properties[0].id,
      status: "review",
      rate_cents: initial.properties[0].rate_cents,
      energy_kwh: 0,
      total_cents: null,
      fee_cents: null,
      stripe_fee_cents: null,
      last_error: "Charger state needs operator review.",
      created_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
  if (params.onboarding === "1") {
    initial.payoutsReady = false;
    initial.stripeConnected = false;
  }
  return <Dashboard initial={initial} demo />;
}
