import { redirect } from "next/navigation";
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
  if (!(await isAdmin(actor)))
    return (
      <main className="admin-denied">
        <h1>Administrator access required</h1>
        <p>
          This account is not an administrator. If you operate this deployment,
          add your email to ADMIN_EMAILS and run scripts/set-admins.mjs, then
          reload.
        </p>
        <a href="/dashboard">Back to dashboard</a>
      </main>
    );
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
