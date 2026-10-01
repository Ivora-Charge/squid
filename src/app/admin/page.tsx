import { notFound, redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { adminSummary, adminTenants, isAdmin } from "@/lib/server/admin";
import { user } from "@/lib/server/db";
import { supabaseConfigured } from "@/lib/server/config";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  if (!supabaseConfigured()) redirect("/login");
  const actor = await user();
  if (!actor) redirect("/login");
  if (!isAdmin(actor)) notFound();
  const [summary, tenants] = await Promise.all([
    adminSummary(),
    adminTenants(),
  ]);
  return (
    <AdminDashboard
      actor={{ id: actor.id, email: actor.email! }}
      initial={{ summary, ...tenants }}
    />
  );
}
