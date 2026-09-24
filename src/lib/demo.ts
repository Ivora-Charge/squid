import type { DashboardData, Property } from "./types";
export const demoProperties: Property[] = [
  {
    id: "demo-cabin",
    host_id: "demo",
    name: "The Weekender",
    slug: "demo",
    address: "24 Pine Ridge Road",
    city: "Asheville",
    state: "NC",
    latitude: 35.59,
    longitude: -82.55,
    time_zone: "America/New_York",
    instructions:
      "Your charger is on the left side of the driveway. Make yourself at home, plug in, and enjoy your stay.",
    connector_type: "J1772",
    max_kw: 7.2,
    rate_cents: 35,
    hold_cents: 2500,
    station_name: "SQ-WEEKENDER",
    station_id: 1,
    connector_id: 1,
    location_id: 1,
    tariff_id: 1,
    ocpp_url: null,
    published: true,
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "demo-cottage",
    host_id: "demo",
    name: "Saltwater Cottage",
    slug: "demo",
    address: "8 Ocean Avenue",
    city: "Charleston",
    state: "SC",
    latitude: 32.78,
    longitude: -79.93,
    time_zone: "America/New_York",
    instructions: "Find the charger next to the guest parking space.",
    connector_type: "NACS",
    max_kw: 11.5,
    rate_cents: 40,
    hold_cents: 2500,
    station_name: "SQ-SALTWATER",
    station_id: 2,
    connector_id: 2,
    location_id: 2,
    tariff_id: 2,
    ocpp_url: null,
    published: true,
    created_at: "2026-09-01T00:00:00Z",
  },
];
export function demoDashboard(): DashboardData {
  const now = new Date();
  return {
    properties: demoProperties,
    email: "alex@example.com",
    payoutsReady: true,
    stripeConnected: true,
    sessions: Array.from({ length: 28 }, (_, i) => {
      const property = demoProperties[i % 2];
      const total = 560 + ((i * 137) % 1200);
      const created = new Date(
        now.getTime() - (i * 0.91 + 0.1) * 86400000,
      ).toISOString();
      return {
        id: `SQ-${String(2048 - i).padStart(4, "0")}`,
        property_id: property.id,
        status: "completed",
        rate_cents: property.rate_cents,
        energy_kwh: Number((total / property.rate_cents).toFixed(2)),
        total_cents: total,
        fee_cents: Math.round(total * 0.06),
        created_at: created,
        started_at: created,
        ended_at: new Date(Date.parse(created) + 2 * 3600000).toISOString(),
      };
    }),
  };
}
