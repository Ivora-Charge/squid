import { Dashboard } from "@/components/dashboard";
import { demoDashboard } from "@/lib/demo";
import { formatEffectiveAt } from "@/lib/money";
import { newHostFeeEffectiveAt } from "@/lib/server/config";
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const initial = demoDashboard(formatEffectiveAt(newHostFeeEffectiveAt()));
  if ((await searchParams).onboarding === "1") {
    initial.payoutsReady = false;
    initial.stripeConnected = false;
  }
  return <Dashboard initial={initial} demo />;
}
