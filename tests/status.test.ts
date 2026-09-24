import { expect, it } from "vitest";
import { chargerStatus, guestAvailability } from "@/lib/status";
const online = {
  online: true,
  connectors: [
    { id: 1, status: "Available" },
    { id: 2, status: "Charging" },
  ],
};
it("reports a station's network status, or unknown when the lookup failed", () => {
  expect(chargerStatus(online)).toBe("online");
  expect(chargerStatus({ ...online, online: false })).toBe("offline");
  expect(chargerStatus(null)).toBe("unknown");
  expect(chargerStatus(undefined)).toBe("unknown");
});
it("lets guests pay only when the station is online and the connector is free", () => {
  expect(guestAvailability(online, 1)).toBe("ready");
  expect(
    guestAvailability(
      { ...online, connectors: [{ id: 1, status: "Preparing" }] },
      1,
    ),
  ).toBe("ready");
  expect(guestAvailability(online, 2)).toBe("unavailable");
  expect(guestAvailability(online, 9)).toBe("unavailable");
  expect(guestAvailability({ ...online, online: false }, 1)).toBe("offline");
  expect(guestAvailability(null, 1)).toBe("offline");
});
