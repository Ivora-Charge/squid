import "server-only";
import { z } from "zod";
import { checked, db, withLock } from "./db";
import {
  getOcppUrl,
  getStation,
  ivora,
  listAll,
  operation,
  tenantPath,
} from "./ivora";
import { payoutStatus } from "./stripe";
import { HttpError } from "./security";
import type { Property } from "../types";
import { configureCredentials } from "./charger-credentials";
export const propertyInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  addressToken: z.string().min(1).max(4000),
  rate_cents: z.number().int().min(1).max(500),
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
    if (!p.location_id) {
      const name = `Squid ${p.id}`;
      const op = await operation(`${id}:location`, "locations", {
        name,
        address: p.address,
        city: p.city,
        state: p.state,
        country: "USA",
        latitude: p.latitude,
        longitude: p.longitude,
        time_zone: p.time_zone,
      });
      if (op.status !== "succeeded")
        throw new Error(
          "Charger setup is pending. Resume setup to check the original operation.",
        );
      const location = (await listAll("locations")).find(
        (l) => l.name === name,
      );
      if (!location || typeof location.id !== "number")
        throw new Error("Charger setup is pending. Resume setup in a moment.");
      await save({ location_id: location.id });
    }
    if (!p.station_id) {
      const op = await operation(`${id}:station`, "stations", {
        name: p.station_name,
        location_id: p.location_id,
        connectors: 1,
      });
      if (op.status !== "succeeded")
        throw new Error(
          "Charger setup is pending. Resume setup to check the original operation.",
        );
      const records = await ivora(
        tenantPath(`stations?name=${encodeURIComponent(p.station_name)}`),
        z.object({
          data: z.array(z.object({ id: z.number(), name: z.string() })),
        }),
      );
      const station = records.data.find((s) => s.name === p.station_name);
      if (!station)
        throw new Error("Charger setup is pending. Resume setup in a moment.");
      const url = op.result?.connection_url;
      await save({
        station_id: station.id,
        ocpp_url: typeof url === "string" ? url : null,
      });
    }
    if (!p.tariff_id) {
      const op = await operation(`${id}:tariff:${p.rate_cents}`, "tariffs", {
        currency: "USD",
        rate_minor_per_kwh: p.rate_cents,
        authorization_minor: p.hold_cents,
      });
      if (op.status !== "succeeded")
        throw new Error(
          "Charger setup is pending. Resume setup to check the original operation.",
        );
      const tariff = (await listAll("tariffs")).find(
        (t) =>
          t.currency === "USD" &&
          Number(t.rate_minor_per_kwh) === p.rate_cents &&
          Number(t.authorization_minor) === p.hold_cents,
      );
      if (!tariff || typeof tariff.id !== "number")
        throw new Error("Charger setup is pending. Resume setup in a moment.");
      await save({ tariff_id: tariff.id });
    }
    if (!p.ocpp_url) {
      const url = await getOcppUrl(p.station_name).catch(() => null);
      if (url) await save({ ocpp_url: url });
    }
    await configureCredentials(p);
    const station = await getStation(p.station_id!);
    if (station.connectors.length)
      await save({ connector_id: station.connectors[0].id });
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
