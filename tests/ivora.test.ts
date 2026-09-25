import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { z } from "zod";
const store = vi.hoisted(() => ({
  rows: new Map<
    string,
    { key: string; request_hash: string; response: unknown; created_at: string }
  >(),
  deleted: [] as string[],
}));
vi.mock("@/lib/server/db", () => ({
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw new Error("Persistence failed");
    return r.data;
  },
  db: () => ({
    from: () => {
      let key = "";
      let values: { response: unknown } | undefined;
      let deleting = false;
      const query = {
        insert: async (input: { key: string; request_hash: string }) => {
          if (store.rows.has(input.key)) return { error: { code: "23505" } };
          store.rows.set(input.key, {
            ...input,
            response: null,
            created_at: new Date().toISOString(),
          });
          return { error: null };
        },
        select: () => query,
        delete: () => {
          deleting = true;
          return query;
        },
        eq: (_field: string, value: string) => {
          key = value;
          return query;
        },
        single: async () => ({ data: store.rows.get(key), error: null }),
        update: (input: { response: unknown }) => {
          values = input;
          return query;
        },
        then: (resolve: (r: unknown) => unknown) => {
          if (deleting) {
            store.rows.delete(key);
            store.deleted.push(key);
          } else if (values) store.rows.get(key)!.response = values.response;
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return query;
    },
  }),
}));
import {
  createResource,
  forget,
  ivora,
  IvoraError,
  rejectionCode,
  tenantPath,
  verifyWebhookSignature,
} from "@/lib/server/ivora";
const fetchMock = vi.fn();
function reply(status: number, body: unknown) {
  return new Response(body === null ? "<html>" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const record = z.object({
  id: z.number(),
  name: z.string(),
  external_reference: z.string().nullable().optional(),
});
beforeEach(() => {
  vi.stubEnv("IVORA_API_KEY", "iv_test_fixture");
  vi.stubEnv("IVORA_TENANT_ID", "18");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  store.rows.clear();
  store.deleted.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Ivora client errors", () => {
  it("turns Ivora's error envelope into a coded IvoraError", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, {
        error: {
          code: "station_offline",
          message: "Station is offline.",
          details: { resource_id: 43 },
        },
        request_id: "req_1",
      }),
    );
    const error = await ivora(tenantPath("stations/43"), record).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IvoraError);
    expect(error).toMatchObject({
      name: "IvoraError",
      status: 409,
      code: "station_offline",
      requestId: "req_1",
      details: { resource_id: 43 },
    });
  });
  it("keeps a generic code when the body is not Ivora's envelope", async () => {
    fetchMock.mockResolvedValueOnce(reply(502, null));
    const error = await ivora(tenantPath("stations/43"), record).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "http_error", status: 502 });
  });
  it("reads the code out of a rejected operation", () => {
    expect(
      rejectionCode({
        id: "op",
        status: "rejected",
        result: { error: { code: "station_online" } },
      }),
    ).toBe("station_online");
    expect(
      rejectionCode({ id: "op", status: "succeeded", result: null }),
    ).toBeNull();
  });
});
describe("synchronous inventory creates", () => {
  const body = {
    name: "sq-loft",
    location_id: 7,
    connectors: 1,
    external_reference: "property:abc",
  };
  it("returns the created record and saves it for replays", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(201, {
        id: 12,
        name: "sq-loft",
        external_reference: "property:abc",
      }),
    );
    const station = await createResource("k1", "stations", record, body);
    expect(station.id).toBe(12);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "k1",
    );
    expect(await createResource("k1", "stations", record, body)).toEqual(
      station,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("adopts the resource that already carries our external reference", async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(409, {
          error: {
            code: "external_reference_taken",
            message: "Taken",
            details: { resource_id: 12 },
          },
        }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          data: [
            { id: 12, name: "sq-loft", external_reference: "property:abc" },
          ],
          next_cursor: 0,
        }),
      );
    expect((await createResource("k2", "stations", record, body)).id).toBe(12);
    const lookup = String((fetchMock.mock.calls[1] as [URL])[0]);
    expect(lookup).toContain("/v1/tenants/18/stations?external_reference=");
    expect(lookup).toContain(encodeURIComponent("property:abc"));
  });
  it("falls back to the station name for stations registered before references", async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(409, { error: { code: "station_name_taken", message: "Taken" } }),
      )
      .mockResolvedValueOnce(reply(200, { data: [], next_cursor: 0 }))
      .mockResolvedValueOnce(
        reply(200, {
          data: [{ id: 5, name: "sq-loft", external_reference: null }],
          next_cursor: 0,
        }),
      );
    expect((await createResource("k3", "stations", record, body)).id).toBe(5);
    expect(String((fetchMock.mock.calls[2] as [URL])[0])).toContain(
      "stations?name=sq-loft",
    );
  });
  it("rethrows codes that are not recoverable by lookup", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(422, { error: { code: "invalid_request", message: "Bad" } }),
    );
    await expect(
      createResource("k4", "stations", record, body),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("forgets a saved request so a rejected operation can be retried", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(201, { id: 1, name: "x", external_reference: "r" }),
    );
    await createResource("k5", "tariffs", record, {
      name: "x",
      external_reference: "r",
    });
    expect(store.rows.has("k5")).toBe(true);
    await forget("k5");
    expect(store.rows.has("k5")).toBe(false);
  });
});
describe("webhook signatures", () => {
  const secret = "whsec_fixture";
  const body = '{"id":"evt_1"}';
  const sign = (t: number) =>
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const now = 1_790_000_000_000;
  it("accepts a fresh, correctly signed delivery", () => {
    expect(verifyWebhookSignature(secret, sign(now / 1000), body, now)).toBe(
      "ok",
    );
  });
  it("rejects a tampered body, wrong secret, or malformed header", () => {
    expect(
      verifyWebhookSignature(secret, sign(now / 1000), body + " ", now),
    ).toBe("invalid");
    expect(verifyWebhookSignature("other", sign(now / 1000), body, now)).toBe(
      "invalid",
    );
    expect(verifyWebhookSignature(secret, "v1=abc", body, now)).toBe("invalid");
    expect(verifyWebhookSignature(secret, null, body, now)).toBe("invalid");
  });
  it("rejects signatures older than five minutes", () => {
    expect(
      verifyWebhookSignature(secret, sign(now / 1000 - 600), body, now),
    ).toBe("stale");
  });
});
