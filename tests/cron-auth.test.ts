import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  reconcile: vi.fn(),
  afterReconcile: vi.fn(),
  queueFilter: vi.fn(() => "queue-filter"),
  continueSending: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/server/sessions", () => ({
  reconcile: mocks.reconcile,
  afterReconcile: mocks.afterReconcile,
  reconcileQueueFilter: mocks.queueFilter,
}));
vi.mock("@/lib/server/newsletter", () => ({
  continueSending: mocks.continueSending,
}));

import { GET as reconcileRoute } from "@/app/api/cron/reconcile/route";
import { GET as newsletterRoute } from "@/app/api/cron/newsletter/route";

const routes = {
  reconcile: reconcileRoute,
  newsletter: newsletterRoute,
};
const request = (name: string, authorization?: string) =>
  new NextRequest(`https://example.test/api/cron/${name}`, {
    headers: authorization ? { authorization } : {},
  });

describe.each(Object.entries(routes))("/api/cron/%s auth", (name, GET) => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    mocks.db.mockReset();
    mocks.db.mockImplementation(() => {
      throw new Error("db must not be touched when unauthorized");
    });
    mocks.reconcile.mockReset();
    mocks.continueSending.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["no header", undefined],
    ["wrong secret", "Bearer wrong-secret-value"],
    ["same length wrong secret", "Bearer test-cron-secreX"],
    ["no Bearer prefix", "test-cron-secret"],
  ])("rejects %s with 401", async (_label, header) => {
    const response = await GET(request(name, header));
    expect(response.status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.continueSending).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["undefined", undefined],
  ])("rejects when CRON_SECRET is %s", async (_label, value) => {
    vi.stubEnv("CRON_SECRET", value);
    // A real Headers object trims "Bearer " to "Bearer", which would fail the
    // length check instead. This header equals the route's expected value
    // exactly, so only the `!process.env.CRON_SECRET` guard can reject it.
    const unsetSecretMatch = {
      headers: { get: () => "Bearer " },
    } as unknown as NextRequest;
    mocks.continueSending.mockResolvedValue({ sent: 0 });
    const response = await GET(unsetSecretMatch);
    expect(response.status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.continueSending).not.toHaveBeenCalled();
    expect((await GET(request(name))).status).toBe(401);
  });

  it("accepts the correct bearer secret", async () => {
    mocks.continueSending.mockResolvedValue({ sent: 0 });
    mocks.db.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      for (const m of [
        "from",
        "select",
        "or",
        "order",
        "delete",
        "lt",
        "update",
        "eq",
      ])
        chain[m] = () => chain;
      chain.limit = async () => ({ data: [], error: null });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });
      return chain;
    });
    const response = await GET(request(name, "Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });
});

describe("/api/cron/reconcile queue", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("selects the bounded queue and settles every session it ran", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const or = vi.fn();
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.or = (filter: string) => {
      or(filter);
      return chain;
    };
    chain.order = () => chain;
    chain.limit = async () => ({
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    });
    chain.delete = () => chain;
    chain.lt = async () => ({});
    mocks.db.mockReset();
    mocks.db.mockImplementation(() => ({ from: () => chain }));
    mocks.reconcile.mockReset();
    mocks.reconcile
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error());
    const settle = vi.fn();
    mocks.afterReconcile.mockImplementation(settle);
    const response = await reconcileRoute(
      request("reconcile", "Bearer test-cron-secret"),
    );
    expect(await response.json()).toEqual({ processed: 1, retry: 1 });
    expect(or).toHaveBeenCalledWith(mocks.queueFilter());
    expect(settle.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });
});
