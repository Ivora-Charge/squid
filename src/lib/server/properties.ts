import "server-only";
import { z } from "zod";
import { checked, db, withLock } from "./db";
import {
  createResource,
  getStation,
  locationRecordSchema,
  stationSchema as stationRecordSchema,
  tariffRecordSchema,
} from "./ivora";
import { payoutStatus } from "./stripe";
import { HttpError } from "./security";
import type { Property } from "../types";
import { configureCredentials } from "./charger-credentials";
export const propertyInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  addressToken: z.string().min(1).max(4000),
  // No price ceiling; the bound only keeps the value inside a Postgres integer.
  rate_cents: z.number().int().min(1).max(2_147_483_647),
  max_kw: z.number().positive().max(22),
  connector_type: z.enum(["J1772", "NACS", "Type 2"]),
  instructions: z.string().trim().max(500),
});
export const propertyUpdate = propertyInput.omit({
  id: true,
  addressToken: true,
});
export async function updateProperty(
  hostId: string,
  id: string,
  fields: z.infer<typeof propertyUpdate>,
): Promise<Property> {
  const current = await ownedProperty(hostId, id);
  const repriced = fields.rate_cents !== current.rate_cents;
  // A new price needs a new Ivora tariff. Clearing tariff_id blocks guest
  // starts until provision() has created it, so no session bills at a stale rate.
  checked(
    await db()
      .from("squid_properties")
      .update({ ...fields, ...(repriced ? { tariff_id: null } : {}) })
      .eq("id", id)
      .eq("host_id", hostId),
  );
  if (repriced) await provision(hostId, id);
  return ownedProperty(hostId, id);
}
export async function ownedProperty(
  hostId: string,
  id: string,
): Promise<Property> {
  const { data, error } = await db()
    .from("squid_properties")
    .select("*")
    .eq("id", id)
    .eq("host_id", hostId)
    .maybeSingle();
  if (error || !data) throw new HttpError(404, "Charger not found.");
  return data as Property;
}
export async function provision(hostId: string, id: string): Promise<Property> {
  return withLock(`property:${id}`, async () => {
    let p = await ownedProperty(hostId, id);
    const save = async (values: Partial<Property>) => {
      checked(
        await db()
          .from("squid_properties")
          .update(values)
          .eq("id", id)
          .eq("host_id", hostId),
      );
      p = { ...p, ...values };
    };
    // Inventory creates return their record; the reference lets a retry adopt
    // what an earlier attempt created. Keys carry a version so requests saved
    // under the older operation-based flow are never replayed as records.
    const reference = `property:${id}`;
    if (!p.location_id) {
      const location = await createResource(
        `${id}:location:v2`,
        "locations",
        locationRecordSchema,
        {
          name: p.name,
          address: p.address,
          city: p.city,
          state: p.state,
          country: "USA",
          latitude: p.latitude,
          longitude: p.longitude,
          time_zone: p.time_zone,
          external_reference: reference,
        },
      );
      await save({ location_id: location.id });
    }
    if (!p.station_id) {
      const station = await createResource(
        `${id}:station:v2`,
        "stations",
        stationRecordSchema,
        {
          name: p.station_name,
          location_id: p.location_id,
          connectors: 1,
          external_reference: reference,
        },
      );
      await save({
        station_id: station.id,
        connector_id: station.connectors[0]?.id ?? null,
        ocpp_url: station.connection_url ?? null,
      });
    }
    if (!p.tariff_id) {
      const tariff = await createResource(
        `${id}:tariff:${p.rate_cents}:v2`,
        "tariffs",
        tariffRecordSchema,
        {
          currency: "USD",
          rate_minor_per_kwh: p.rate_cents,
          authorization_minor: p.hold_cents,
          external_reference: `${reference}:rate:${p.rate_cents}`,
        },
      );
      await save({ tariff_id: tariff.id });
    }
    await configureCredentials(p);
    if (!p.connector_id || !p.ocpp_url) {
      const station = await getStation(p.station_id!);
      await save({
        connector_id: station.connectors[0]?.id ?? p.connector_id,
        ocpp_url: station.connection_url ?? p.ocpp_url,
      });
    }
    return p;
  });
}
export async function publish(hostId: string, id: string) {
  const p = await ownedProperty(hostId, id);
  if (!p.station_id || !p.connector_id || !p.tariff_id)
    throw new Error("Charger setup is incomplete. Connect the charger first.");
  const station = await getStation(p.station_id);
  if (!station.online)
    throw new Error("Your charger is offline. Connect it before publishing.");
  if (!(await payoutStatus(hostId)).ready)
    throw new Error(
      "Connect Stripe and finish payout onboarding before publishing.",
    );
  checked(
    await db()
      .from("squid_properties")
      .update({ published: true })
      .eq("id", id)
      .eq("host_id", hostId),
  );
}
