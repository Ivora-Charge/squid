import { notFound } from "next/navigation";
import { GuestCharge } from "@/components/guest-charge";
import { demoProperties } from "@/lib/demo";
import { db } from "@/lib/server/db";
import { getStation } from "@/lib/server/ivora";
import type { PublicProperty } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function ChargerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "demo") {
    const p = demoProperties[0];
    return (
      <GuestCharge demo property={{ ...p, available: true, testMode: true }} />
    );
  }
  if (!/^[a-zA-Z0-9-]{1,60}$/.test(slug)) notFound();
  const { data: p, error } = await db()
    .from("squid_properties")
    .select(
      "id,slug,name,city,state,instructions,connector_type,max_kw,rate_cents,hold_cents,station_id,connector_id",
    )
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error || !p) notFound();
  const station = p.station_id
    ? await getStation(p.station_id).catch(() => null)
    : null;
  const available = Boolean(
    station?.online &&
    station.connectors.some(
      (c) =>
        c.id === p.connector_id &&
        ["Available", "Preparing"].includes(c.status ?? ""),
    ),
  );
  const { station_id: _, connector_id: __, ...safe } = p;
  return (
    <GuestCharge
      property={
        {
          ...safe,
          available,
          testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),
        } as PublicProperty
      }
    />
  );
}
