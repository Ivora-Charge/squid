import { Dashboard } from "@/components/dashboard";
import { demoDashboard } from "@/lib/demo";
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const initial = demoDashboard();
  if ((await searchParams).onboarding === "1") {
    initial.payoutsReady = false;
    initial.stripeConnected = false;
  }
  return <Dashboard initial={initial} demo />;
}
