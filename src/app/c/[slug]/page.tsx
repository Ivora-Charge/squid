import { notFound } from "next/navigation";
import { GuestCharge } from "@/components/guest-charge";
import { demoProperties } from "@/lib/demo";
import { db } from "@/lib/server/db";
import { getStation } from "@/lib/server/ivora";
import { guestAvailability } from "@/lib/status";
import type { PublicProperty } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function ChargerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ offline?: string }>;
}) {
  const { slug } = await params;
  if (slug === "demo") {
    const p = demoProperties[0];
    // ?offline=1 previews what guests see while a charger is disconnected.
    const availability =
      (await searchParams).offline === "1" ? "offline" : "ready";
    return (
      <GuestCharge demo property={{ ...p, availability, testMode: true }} />
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
  const { station_id: _, connector_id: __, ...safe } = p;
  return (
    <GuestCharge
      property={
        {
          ...safe,
          availability: guestAvailability(station, p.connector_id),
          testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),
        } as PublicProperty
      }
    />
  );
}
