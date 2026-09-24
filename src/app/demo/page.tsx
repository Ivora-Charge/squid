import { Dashboard } from "@/components/dashboard";
import { demoDashboard } from "@/lib/demo";
export default function DemoPage() {
  return <Dashboard initial={demoDashboard()} demo />;
}
