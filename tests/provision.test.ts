import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const host = "10000000-0000-4000-8000-000000000001",
  property = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  updates: vi.fn(),
  create: vi.fn(),
  getStation: vi.fn(),
  row: {} as Record<string, unknown>,
}));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { ...mocks.row }, error: null }),
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          eq: async () => {
            mocks.updates(values);
            Object.assign(mocks.row, values);
            return { data: null, error: null };
          },
        }),
      }),
    }),
  }),
  withLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  checked: (value: { data: unknown; error: unknown }) => {
    if (value.error) throw new Error("db");
    return value.data;
  },
}));
vi.mock("@/lib/server/ivora", async (original) => ({
  ...(await original<typeof import("@/lib/server/ivora")>()),
  createResource: mocks.create,
  getStation: mocks.getStation,
}));
vi.mock("@/lib/server/stripe", () => ({ payoutStatus: vi.fn() }));
vi.mock("@/lib/server/charger-credentials", () => ({
  configureCredentials: vi.fn(),
}));
import { ownedProperty, provision } from "@/lib/server/properties";
import { IvoraError } from "@/lib/server/ivora";
import { failure } from "@/lib/server/security";
import { chargerIdProblem } from "@/lib/onboarding";

const projectStation = {
  id: 41,
  name: "p18-bluebird-cabin-200000",
  online: false,
  protocol: null,
  charger_id: "bluebird-cabin-200000",
  username: "bluebird-cabin-200000",
  connection_url: "wss://ocpp.ivora.example/18/bluebird-cabin-200000",
  custom_connection_urls: [
    {
      domain: "ocpp.squid.example",
      url: "wss://ocpp.squid.example/18/bluebird-cabin-200000",
      status: "active",
    },
  ],
  external_reference: `property:${property}`,
  connectors: [{ id: 51, number: 1, status: null }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("IVORA_API_KEY", "iv_test_fixture");
  vi.stubEnv("IVORA_TENANT_ID", "18");
  vi.stubEnv("OCPP_URL_PREFIX", "");
  Object.keys(mocks.row).forEach((k) => delete mocks.row[k]);
  Object.assign(mocks.row, {
    id: property,
    host_id: host,
    name: "Bluebird Cabin",
    rate_cents: 35,
    hold_cents: 2500,
    station_name: "bluebird-cabin-200000",
    charger_id: null,
    location_id: 9,
    station_id: null,
    connector_id: null,
    tariff_id: 3,
    ocpp_url: null,
    published: false,
  });
  mocks.create.mockResolvedValue(projectStation);
});
afterEach(() => vi.unstubAllEnvs());

describe("registering a new charger", () => {
  it("registers with charger_id, never a global name, and saves the custom-domain address", async () => {
    const p = await provision(host, property);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [key, resource, , body] = mocks.create.mock.calls[0];
    expect(key).toBe(`${property}:station:v3`);
    expect(resource).toBe("stations");
    expect(body).toEqual({
      charger_id: "bluebird-cabin-200000",
      location_id: 9,
      connectors: 1,
      external_reference: `property:${property}`,
    });
    expect(body).not.toHaveProperty("name");
    expect(p).toMatchObject({
      station_id: 41,
      connector_id: 51,
      charger_id: "bluebird-cabin-200000",
      ocpp_url: "wss://ocpp.squid.example/18/bluebird-cabin-200000",
    });
    expect(mocks.getStation).not.toHaveBeenCalled();
  });
  it("falls back to connection_url without an active custom domain", async () => {
    mocks.create.mockResolvedValue({
      ...projectStation,
      custom_connection_urls: [],
    });
    const p = await provision(host, property);
    expect(p.ocpp_url).toBe(
      "wss://ocpp.ivora.example/18/bluebird-cabin-200000",
    );
  });
  it("ignores OCPP_URL_PREFIX for a charger_id station", async () => {
    vi.stubEnv("OCPP_URL_PREFIX", "wss://ocpp.squid.example/sp1");
    await provision(host, property);
    expect(mocks.row.ocpp_url).toBe(
      "wss://ocpp.squid.example/18/bluebird-cabin-200000",
    );
    expect((await ownedProperty(host, property)).ocpp_url).toBe(
      "wss://ocpp.squid.example/18/bluebird-cabin-200000",
    );
  });
  it("refuses a charger ID too long for the project before calling Ivora", async () => {
    vi.stubEnv("IVORA_TENANT_ID", "123456789012345");
    mocks.row.station_name = "bluebird-cabin-with-a-long-id1";
    await expect(provision(host, property)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps a station an earlier name request created on its legacy address", async () => {
    vi.stubEnv("OCPP_URL_PREFIX", "wss://ocpp.squid.example/sp1");
    mocks.create.mockResolvedValue({
      ...projectStation,
      name: "bluebird-cabin-200000",
      charger_id: null,
      connection_url: "wss://csms.ivora.example/bluebird-cabin-200000",
      custom_connection_urls: [],
    });
    const p = await provision(host, property);
    expect(p.charger_id).toBeNull();
    expect(p.ocpp_url).toBe(
      "wss://ocpp.squid.example/sp1/bluebird-cabin-200000",
    );
  });
  it("refreshes a missing project address from Ivora's station read", async () => {
    Object.assign(mocks.row, {
      station_id: 41,
      connector_id: 51,
      charger_id: "bluebird-cabin-200000",
      ocpp_url: null,
    });
    mocks.getStation.mockResolvedValue(projectStation);
    const p = await provision(host, property);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(p.ocpp_url).toBe(
      "wss://ocpp.squid.example/18/bluebird-cabin-200000",
    );
  });
  it("leaves the property saved and unregistered when Ivora refuses", async () => {
    mocks.create.mockRejectedValue(
      new IvoraError(409, "project_urls_disabled", "off"),
    );
    await expect(provision(host, property)).rejects.toMatchObject({
      code: "project_urls_disabled",
    });
    expect(mocks.row.station_id).toBeNull();
  });
});

describe("existing chargers registered by name", () => {
  it("keep their current /sp1/ address", async () => {
    vi.stubEnv("OCPP_URL_PREFIX", "wss://ocpp.squid.example/sp1");
    Object.assign(mocks.row, {
      station_name: "weekender-abc123",
      station_id: 3,
      connector_id: 3,
      ocpp_url: "wss://csms.ivora.example/weekender-abc123",
    });
    expect((await ownedProperty(host, property)).ocpp_url).toBe(
      "wss://ocpp.squid.example/sp1/weekender-abc123",
    );
  });
});

describe("host-facing registration errors", () => {
  it.each([
    ["station_name_taken", 409, /already registered/],
    ["project_urls_disabled", 503, /can’t be registered right now/],
    ["global_charger_url_retired", 503, /can’t be registered right now/],
  ])("explains %s", async (code, status, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failure(new IvoraError(409, code, "internal detail"));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toMatch(message);
    expect(body.error).not.toContain("internal detail");
  });
});

describe("charger ID rules", () => {
  it("accepts Ivora's charset within 36 characters including p<project>-", () => {
    expect(chargerIdProblem("bluebird-cabin-a1b2c3", "18")).toBeNull();
    expect(chargerIdProblem("A".repeat(32), "18")).toBeNull();
    expect(chargerIdProblem("A".repeat(33), "18")).toMatch(/at most 32/);
    expect(chargerIdProblem("-leading", "18")).toMatch(/starts with/);
    expect(chargerIdProblem("has space", "18")).toMatch(/letters/);
    expect(chargerIdProblem("", "18")).toMatch(/letters/);
  });
});
