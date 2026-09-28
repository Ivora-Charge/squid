import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAddress,
  selectAddress,
  signAddress,
  suggestAddresses,
} from "@/lib/server/addresses";
import { stationIdentity } from "@/lib/onboarding";
const host = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const address = {
  address: "12 Forest Lane",
  city: "Asheville",
  state: "NC",
  latitude: 35.5951,
  longitude: -82.5515,
  time_zone: "America/New_York",
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private-signing-key");
  vi.stubEnv("GOOGLE_MAPS_ADDRESS_API_KEY", "test-private-google-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("address selection", () => {
  it("accepts only an unmodified, unexpired address selected by this host", () => {
    const token = signAddress(host, address);
    expect(readAddress(token, host)).toEqual(address);
    expect(() => readAddress(token, other)).toThrow(/select.*again/);
    const [payload, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
    changed.address.latitude = 0;
    expect(() =>
      readAddress(
        `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`,
        host,
      ),
    ).toThrow(/suggestions/);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600001);
    expect(() => readAddress(token, host)).toThrow(/expired/);
  });
  it("searches only US addresses without exposing provider credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "place-test",
                text: { text: "12 Forest Lane, Asheville, NC" },
              },
            },
          ],
        }),
      ),
    );
    expect(await suggestAddresses("12 Forest", host)).toEqual([
      { id: "place-test", label: "12 Forest Lane, Asheville, NC" },
    ]);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      includedRegionCodes: ["us"],
      sessionToken: host,
    });
    expect(options.headers["X-Goog-Api-Key"]).toBe("test-private-google-key");
  });
  it("resolves the property time zone from its coordinates, not the host's browser", async () => {
    const component = (
      type: string,
      longText: string,
      shortText = longText,
    ) => ({ types: [type], longText, shortText });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          formattedAddress: "18 Ocean Avenue, San Diego, CA, USA",
          location: { latitude: 32.7157, longitude: -117.1611 },
          addressComponents: [
            component("street_number", "18"),
            component("route", "Ocean Avenue"),
            component("locality", "San Diego"),
            component("administrative_area_level_1", "California", "CA"),
            component("country", "United States", "US"),
          ],
        }),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "OK", timeZoneId: "America/Los_Angeles" }),
      ),
    );
    const result = await selectAddress("place-test", other, host);
    expect(readAddress(result.token, host)).toMatchObject({
      address: "18 Ocean Avenue",
      state: "CA",
      latitude: 32.7157,
      longitude: -117.1611,
      time_zone: "America/Los_Angeles",
    });
    expect(
      new URL(fetchMock.mock.calls[1][0]).searchParams.get("location"),
    ).toBe("32.7157,-117.1611");
  });
  it("does not substitute coordinates when a search provider fails", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"private provider detail"}}', {
        status: 403,
      }),
    );
    await expect(suggestAddresses("12 Forest", host)).rejects.toThrow(
      "Address search is temporarily unavailable.",
    );
  });
});
describe("station identities", () => {
  it("keeps familiar words, supported characters and short identities", () => {
    expect(
      stationIdentity("Bluebird Cabin", "a1b2c300-0000-4000-8000-000000000001"),
    ).toBe("bluebird-cabin-a1b2c3");
    for (const name of [
      "Café at the beach",
      "A very long vacation home name with lots of words",
      "小屋",
      "-- ! --",
    ])
      expect(stationIdentity(name, host)).toMatch(/^[a-z0-9][a-z0-9-]{2,22}$/);
    expect(stationIdentity("Same name", host)).not.toBe(
      stationIdentity("Same name", "20000000-0000-4000-8000-000000000001"),
    );
  });
});
