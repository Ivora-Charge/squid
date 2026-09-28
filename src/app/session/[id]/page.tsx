import { SessionView } from "@/components/session-view";
import { demoProperties } from "@/lib/demo";
import { requireGuest } from "@/lib/server/security";
import { loadSession, publicSession } from "@/lib/server/sessions";
import { db } from "@/lib/server/db";
import { Brand } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "demo")
    return (
      <SessionView
        demo
        propertyName={demoProperties[0].name}
        initial={{
          id: "demo",
          property_id: "demo-cabin",
          status: "charging",
          rate_cents: 35,
          hold_cents: 2500,
          checkout_url: null,
          energy_kwh: 0,
          total_cents: null,
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          ended_at: null,
          stop_requested: false,
        }}
      />
    );
  try {
    await requireGuest(id);
  } catch {
    return (
      <main id="main" className="setup-page">
        <Brand />
        <h1>This session belongs to your charging browser.</h1>
        <p>
          For your privacy, open this page on the device you used to start
          charging. Your host can help if you’ve lost access.
        </p>
      </main>
    );
  }
  const session = await loadSession(id);
  const { data } = await db()
    .from("squid_properties")
    .select("name")
    .eq("id", session.property_id)
    .single();
  return (
    <SessionView
      initial={publicSession(session)}
      propertyName={data?.name ?? "Your charging stay"}
    />
  );
}
