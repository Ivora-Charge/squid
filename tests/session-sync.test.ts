import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChargeSession } from "@/lib/types";
const mock = vi.hoisted(() => ({
  session: {} as ChargeSession,
  locks: new Set<string>(),
  getExternal: vi.fn(),
  capture: vi.fn(),
  external: {} as Record<string, unknown>,
  pi: {} as Record<string, unknown>,
}));
vi.mock("@/lib/server/db", () => {
  class LockBusyError extends Error {}
  return {
    LockBusyError,
    checked: (result: { data: unknown }) => result.data,
    // Same contract as the database lease: a second claimant is turned away.
    withLock: async (key: string, run: () => Promise<unknown>) => {
      if (mock.locks.has(key)) throw new LockBusyError();
      mock.locks.add(key);
      try {
        return await run();
      } finally {
        mock.locks.delete(key);
      }
    },
    db: () => ({
      from: (table: string) => {
        let values: Partial<ChargeSession> | null = null;
        let cutoff: string | null = null;
        const q = {
          select: () => q,
          eq: () => q,
          lte: (_field: string, value: string) => {
            cutoff = value;
            return q;
          },
          update: (v: Partial<ChargeSession>) => {
            values = v;
            return q;
          },
          maybeSingle: async () => ({ data: mock.session, error: null }),
          single: async () => ({
            data:
              table === "squid_sessions"
                ? mock.session
                : { id: "property", station_id: 1, connector_id: 2 },
            error: null,
          }),
          then: (resolve: (v: unknown) => unknown) => {
            // Conditional update: only a row at or before the cutoff matches.
            if (cutoff && mock.session.updated_at > cutoff)
              return Promise.resolve(resolve({ data: [], error: null }));
            if (values) Object.assign(mock.session, values);
            return Promise.resolve(
              resolve({ data: [{ id: mock.session.id }], error: null }),
            );
          },
        };
        return q;
      },
    }),
  };
});
vi.mock("@/lib/server/stripe", () => ({
  stripe: () => ({
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: "cs_test",
          status: "complete",
          payment_intent: "pi_test",
        }),
      },
    },
    paymentIntents: {
      retrieve: async (_id: string, params?: { expand?: string[] }) => ({
        ...mock.pi,
        ...(params?.expand
          ? {
              latest_charge: {
                balance_transaction: {
                  fee_details: [
                    { type: "stripe_fee", amount: 37 },
                    {
                      type: "application_fee",
                      amount: mock.pi.application_fee_amount,
                    },
                  ],
                },
              },
            }
          : {}),
      }),
      capture: mock.capture,
    },
    refunds: {},
  }),
  payoutStatus: async () => ({ id: "acct_host", ready: true }),
  paymentOptions: async () => ({ stripeAccount: "acct_host" }),
}));
vi.mock("@/lib/server/ivora", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ivora")>();
  return {
    ...actual,
    durable: async (_k: string, _i: unknown, run: () => Promise<unknown>) =>
      run(),
    getExternal: mock.getExternal,
    getStation: async () => ({ online: true }),
    operation: vi.fn(),
    writeIvora: vi.fn(async () => ({})),
  };
});
vi.mock("@/lib/server/security", async (original) => ({
  ...(await original<typeof import("@/lib/server/security")>()),
  requireGuest: async () => undefined,
}));
import { GET, POST } from "@/app/api/sessions/[id]/route";
import { reconcile, syncIfStale, syncWindowMs } from "@/lib/server/sessions";
const id = "session-one";
const context = () => ({ params: Promise.resolve({ id }) });
const NOW = "2026-09-23T11:00:00Z";
function get() {
  return GET(
    new NextRequest(`https://squid.example/api/sessions/${id}`),
    context(),
  );
}
function post(action: string) {
  return POST(
    new NextRequest(`https://squid.example/api/sessions/${id}`, {
      method: "POST",
      headers: {
        origin: "https://squid.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    }),
    context(),
  );
}
const finished = () => ({
  id: "ext_one",
  status: "completed",
  usage: null,
  bill: {
    id: "bill_one",
    status: "final",
    total_minor: 243,
    energy_kwh: "6.941",
    transaction_id: 10,
  },
  start_operation: { id: "op", status: "succeeded", result: {} },
  stop_operation: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SESSION_SYNC_WINDOW_SECONDS", "45");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  mock.locks.clear();
  mock.session = {
    id,
    request_id: "request-one",
    property_id: "property",
    host_id: "host",
    stripe_account_id: "acct_host",
    status: "charging",
    rate_cents: 35,
    hold_cents: 2500,
    fee_basis_points: 600,
    tariff_id: 3,
    stripe_checkout_id: "cs_test",
    stripe_payment_id: "pi_test",
    checkout_url: null,
    ivora_session_id: "ext_one",
    energy_kwh: 1,
    total_cents: null,
    fee_cents: null,
    stripe_fee_cents: null,
    stop_requested: false,
    refund_requested: false,
    last_error: null,
    created_at: "2026-09-23T10:00:00Z",
    updated_at: NOW,
    started_at: null,
    ended_at: null,
  };
  mock.pi = {
    id: "pi_test",
    status: "requires_capture",
    currency: "usd",
    amount: 2500,
    amount_capturable: 2500,
    amount_received: 0,
    application_fee_amount: 0,
    capture_method: "manual",
    metadata: { squid_session_id: id },
    transfer_data: null,
  };
  mock.external = finished();
  mock.getExternal.mockImplementation(async () =>
    structuredClone(mock.external),
  );
  mock.capture.mockImplementation(async (_id: string, input: any) => {
    // Hold the lock long enough for a competing caller to arrive.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    Object.assign(mock.pi, {
      status: "succeeded",
      amount_received: input.amount_to_capture,
      application_fee_amount: input.application_fee_amount,
    });
    return mock.pi;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const age = (seconds: number) =>
  (mock.session.updated_at = new Date(
    Date.now() - seconds * 1000,
  ).toISOString());
describe("guest session reads", () => {
  it("serves repeated polls from the stored snapshot without calling Ivora", async () => {
    age(10);
    for (let i = 0; i < 20; i++) {
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).session).toMatchObject({
        id,
        status: "charging",
      });
    }
    // The old client posted action=sync; it gets the same gated behaviour.
    await post("sync");
    expect(mock.getExternal).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("syncs a stale snapshot exactly once per window", async () => {
    age(60);
    const results = await Promise.all([
      syncIfStale(id),
      syncIfStale(id),
      syncIfStale(id),
    ]);
    expect(results).toHaveLength(3);
    expect(mock.getExternal).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) await get();
    expect(mock.getExternal).toHaveBeenCalledTimes(1);
    // The next window allows one more.
    mock.session.status = "charging";
    mock.external = { ...finished(), status: "charging" };
    age(46);
    await get();
    expect(mock.getExternal).toHaveBeenCalledTimes(2);
  });
  it("finishes a session with no webhooks by itself once stale (previews)", async () => {
    age(50);
    const response = await get();
    expect((await response.json()).session).toMatchObject({
      status: "completed",
      total_cents: 243,
    });
    expect(mock.capture).toHaveBeenCalledTimes(1);
  });
  it("does not consult Ivora for a finished session", async () => {
    mock.session.status = "completed";
    age(3600);
    await get();
    expect(mock.getExternal).not.toHaveBeenCalled();
  });
  it("keeps the window within 15 to 300 seconds", () => {
    vi.stubEnv("SESSION_SYNC_WINDOW_SECONDS", "1");
    expect(syncWindowMs()).toBe(15000);
    vi.stubEnv("SESSION_SYNC_WINDOW_SECONDS", "99999");
    expect(syncWindowMs()).toBe(300000);
    vi.stubEnv("SESSION_SYNC_WINDOW_SECONDS", "");
    expect(syncWindowMs()).toBe(45000);
  });
});
describe("explicit actions and webhooks", () => {
  it("reconciles a stop request immediately, even with a fresh snapshot", async () => {
    age(1);
    mock.external = {
      ...finished(),
      status: "charging",
      usage: {
        transaction_id: 10,
        active: true,
        energy_kwh: "1",
        estimated_minor: 35,
        started_at: NOW,
        ended_at: null,
      },
    };
    await post("stop");
    expect(mock.session.stop_requested).toBe(true);
    expect(mock.getExternal).toHaveBeenCalled();
  });
  it("a webhook-triggered reconcile moves the snapshot forward", async () => {
    age(1);
    await reconcile(id);
    expect(mock.session).toMatchObject({
      status: "completed",
      total_cents: 243,
    });
    // The following poll is a pure database read.
    mock.getExternal.mockClear();
    await get();
    expect(mock.getExternal).not.toHaveBeenCalled();
  });
  it("a concurrent webhook and fallback sync capture once", async () => {
    age(60);
    const [webhook, fallback] = await Promise.allSettled([
      reconcile(id),
      syncIfStale(id),
    ]);
    expect(
      [webhook, fallback].filter((r) => r.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    await reconcile(id);
    expect(mock.capture).toHaveBeenCalledTimes(1);
    expect(mock.capture).toHaveBeenCalledWith(
      "pi_test",
      expect.objectContaining({ amount_to_capture: 243 }),
      expect.objectContaining({ idempotencyKey: `${id}:capture` }),
    );
    expect(mock.session.status).toBe("completed");
  });
});
