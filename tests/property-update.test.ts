import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const host = "10000000-0000-4000-8000-000000000001",
  property = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  updates: vi.fn(),
  create: vi.fn(),
  getStation: vi.fn(),
  row: {} as Record<string, unknown>,
}));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  db: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mocks.row, error: null }),
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
  seedCredentials: vi.fn(),
}));
import { POST } from "@/app/api/host/properties/[id]/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("IVORA_API_KEY", "iv_test_fixture");
  vi.stubEnv("IVORA_TENANT_ID", "18");
  mocks.user.mockResolvedValue({ id: host, email: "host@example.invalid" });
  Object.keys(mocks.row).forEach((k) => delete mocks.row[k]);
  Object.assign(mocks.row, {
    id: property,
    host_id: host,
    name: "The Weekender",
    connector_type: "J1772",
    max_kw: 7.2,
    rate_cents: 35,
    instructions: "Plug in.",
    hold_cents: 2500,
    station_name: "weekender-abc123",
    location_id: 1,
    station_id: 3,
    connector_id: 3,
    tariff_id: 3,
    ocpp_url: "wss://ocpp.example/weekender-abc123",
    published: true,
  });
  mocks.create.mockImplementation(async (_key: string, resource: string) => ({
    id: resource === "tariffs" ? 7 : 99,
    currency: "USD",
    rate_minor_per_kwh: 42,
    authorization_minor: 2500,
  }));
  mocks.getStation.mockResolvedValue({
    id: 3,
    online: true,
    connectors: [{ id: 3, status: "Available" }],
  });
});
afterEach(() => vi.unstubAllEnvs());
const fields = {
  name: "Bluebird Cabin",
  connector_type: "NACS",
  max_kw: 11,
  rate_cents: 35,
  instructions: "Park by the barn.",
};
function request(body: unknown) {
  return new NextRequest(
    `https://squid.example/api/host/properties/${property}`,
    {
      method: "POST",
      headers: {
        origin: "https://squid.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}
async function update(body: unknown) {
  const response = await POST(request(body), {
    params: Promise.resolve({ id: property }),
  });
  return { status: response.status, body: await response.json() };
}
it("saves charger details without touching the tariff when the price is unchanged", async () => {
  const result = await update({ action: "update", ...fields });
  expect(result.status).toBe(200);
  expect(result.body.property).toMatchObject({ ...fields, tariff_id: 3 });
  expect(mocks.updates).toHaveBeenCalledWith(fields);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("clears the tariff and creates a new one synchronously when the price changes", async () => {
  const result = await update({ action: "update", ...fields, rate_cents: 42 });
  expect(result.status).toBe(200);
  expect(mocks.updates).toHaveBeenCalledWith({
    ...fields,
    rate_cents: 42,
    tariff_id: null,
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith(
    `${property}:tariff:42:v2`,
    "tariffs",
    expect.anything(),
    {
      currency: "USD",
      rate_minor_per_kwh: 42,
      authorization_minor: 2500,
      external_reference: `property:${property}:rate:42`,
    },
  );
  expect(result.body.property).toMatchObject({ rate_cents: 42, tariff_id: 7 });
});
it("rejects fields outside the allowed schema", async () => {
  expect(
    (await update({ action: "update", ...fields, slug: "x" })).status,
  ).toBe(400);
  expect(
    (await update({ action: "update", ...fields, rate_cents: 0 })).status,
  ).toBe(400);
  expect(mocks.updates).not.toHaveBeenCalled();
});
it("accepts any positive price, with no ceiling", async () => {
  const result = await update({
    action: "update",
    ...fields,
    rate_cents: 1250,
  });
  expect(result.status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(
    `${property}:tariff:1250:v2`,
    "tariffs",
    expect.anything(),
    expect.objectContaining({ rate_minor_per_kwh: 1250 }),
  );
  expect(result.body.property).toMatchObject({
    rate_cents: 1250,
    tariff_id: 7,
  });
});
