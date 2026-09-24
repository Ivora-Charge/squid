import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  rows: new Map<
    string,
    { key: string; request_hash: string; response: unknown; created_at: string }
  >(),
  failSave: false,
  failInsert: false,
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
      const query = {
        insert: async (input: { key: string; request_hash: string }) => {
          if (store.failInsert) return { error: { code: "08000" } };
          if (store.rows.has(input.key)) return { error: { code: "23505" } };
          store.rows.set(input.key, {
            ...input,
            response: null,
            created_at: new Date().toISOString(),
          });
          return { error: null };
        },
        select: () => query,
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
          if (store.failSave)
            return Promise.resolve(resolve({ error: { code: "08000" } }));
          if (values) Object.assign(store.rows.get(key)!, values);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  }),
}));
import { durable } from "@/lib/server/ivora";
beforeEach(() => {
  store.rows.clear();
  store.failSave = false;
  store.failInsert = false;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("durable provider requests", () => {
  it("persists identity before dispatch and returns saved results on retry", async () => {
    const provider = vi.fn(async () => {
      expect(store.rows.has("capture:one")).toBe(true);
      return { id: "pi_one" };
    });
    await durable("capture:one", { amount: 100, fee: 6 }, provider);
    expect(
      await durable("capture:one", { fee: 6, amount: 100 }, provider),
    ).toEqual({ id: "pi_one" });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch if the identity could not be saved first", async () => {
    store.failInsert = true;
    const provider = vi.fn();
    await expect(durable("capture:one", {}, provider)).rejects.toThrow(
      "before sending",
    );
    expect(provider).not.toHaveBeenCalled();
  });
  it("refuses a changed capture amount under an existing identity", async () => {
    const provider = vi.fn(async () => ({ id: "pi_one" }));
    await durable("capture:one", { amount: 100 }, provider);
    await expect(
      durable("capture:one", { amount: 200 }, provider),
    ).rejects.toThrow("Saved request differs");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("retains the original identity after provider success and a database failure", async () => {
    const provider = vi.fn(async () => ({ id: "pi_one" }));
    store.failSave = true;
    await expect(
      durable("capture:one", { amount: 100 }, provider, true),
    ).rejects.toThrow("Persistence failed");
    const originalHash = store.rows.get("capture:one")!.request_hash;
    store.failSave = false;
    expect(
      await durable("capture:one", { amount: 100 }, provider, true),
    ).toEqual({ id: "pi_one" });
    expect(store.rows.get("capture:one")!.request_hash).toBe(originalHash);
  });
  it("never replays an unacknowledged Stripe request outside its safe retry window", async () => {
    const provider = vi.fn(async () => {
      throw new Error("Lost response");
    });
    await expect(durable("capture:one", {}, provider, true)).rejects.toThrow(
      "Lost response",
    );
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    await expect(durable("capture:one", {}, provider, true)).rejects.toThrow(
      "operator review",
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
