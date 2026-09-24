import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ChargeSession } from "@/lib/types";
const mock = vi.hoisted(() => ({
  session: {} as ChargeSession,
  checkout: {
    id: "cs_test",
    payment_intent: "pi_test" as string | null,
    status: "complete",
  },
  pi: {
    id: "pi_test",
    status: "requires_capture",
    currency: "usd",
    amount: 2500,
    amount_capturable: 2500,
    amount_received: 0,
    application_fee_amount: 0,
    capture_method: "manual",
    metadata: { squid_session_id: "session-one" },
    transfer_data: { destination: "acct_host" },
  },
  external: {
    id: "ext_one",
    status: "charging",
    bill: {
      id: "bill_one",
      status: "open",
      total_minor: null as number | null,
      energy_kwh: null as string | null,
      transaction_id: null as number | null,
    },
    usage: {
      transaction_id: 10,
      active: true,
      energy_kwh: "6.941",
      estimated_minor: 243,
      started_at: "2026-09-23T10:00:00Z",
      ended_at: null as string | null,
    },
    start_operation: {
      id: "op_start",
      status: "succeeded",
      result: { status: "Accepted" },
    },
    stop_operation: null,
  },
  capture: vi.fn(),
  cancel: vi.fn(),
  operation: vi.fn(),
  write: vi.fn(),
  refund: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({
  checked: (result: { data: unknown }) => result.data,
  withLock: async (_key: string, run: () => Promise<unknown>) => run(),
  db: () => ({
    from: (table: string) => {
      let values: Partial<ChargeSession> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        update: (v: Partial<ChargeSession>) => {
          values = v;
          return q;
        },
        maybeSingle: async () => ({ data: mock.session, error: null }),
        single: async () => ({
          data:
            table === "squid_sessions"
              ? mock.session
              : {
                  id: "property",
                  station_id: 1,
                  connector_id: 2,
                  tariff_id: 3,
                  name: "The Weekender",
                },
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) => {
          if (values) Object.assign(mock.session, values);
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/server/stripe", () => ({
  stripe: () => ({
    checkout: {
      sessions: {
        retrieve: async () => ({ ...mock.checkout }),
        expire: mock.expire,
      },
    },
    paymentIntents: {
      retrieve: async () => ({ ...mock.pi }),
      capture: mock.capture,
      cancel: mock.cancel,
    },
    refunds: {
      create: mock.refund,
      retrieve: async () => ({
        id: "re_test",
        status: "succeeded",
        amount: 243,
      }),
    },
  }),
  payoutStatus: async () => ({ id: "acct_host", ready: true }),
}));
vi.mock("@/lib/server/ivora", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ivora")>();
  return {
    ...actual,
    durable: async (
      _key: string,
      _input: unknown,
      run: () => Promise<unknown>,
    ) => run(),
    getExternal: async () => structuredClone(mock.external),
    getStation: async () => ({ online: true }),
    operation: mock.operation,
    writeIvora: mock.write,
  };
});
import { reconcile } from "@/lib/server/sessions";
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T11:00:00Z"));
  Object.assign(mock.checkout, {
    id: "cs_test",
    payment_intent: "pi_test",
    status: "complete",
  });
  mock.session = {
    id: "session-one",
    request_id: "request-one",
    property_id: "property",
    host_id: "host",
    stripe_account_id: "acct_host",
    status: "charging",
    rate_cents: 35,
    hold_cents: 2500,
    tariff_id: 3,
    stripe_checkout_id: "cs_test",
    stripe_payment_id: "pi_test",
    checkout_url: null,
    ivora_session_id: "ext_one",
    energy_kwh: 0,
    total_cents: null,
    fee_cents: null,
    stop_requested: false,
    refund_requested: false,
    last_error: null,
    created_at: "2026-09-23T09:00:00Z",
    updated_at: "2026-09-23T09:00:00Z",
    started_at: null,
    ended_at: null,
  };
  Object.assign(mock.pi, {
    status: "requires_capture",
    amount: 2500,
    amount_capturable: 2500,
    amount_received: 0,
    application_fee_amount: 0,
    metadata: { squid_session_id: "session-one" },
    transfer_data: { destination: "acct_host" },
  });
  Object.assign(mock.external, {
    status: "charging",
    bill: {
      id: "bill_one",
      status: "open",
      total_minor: null,
      energy_kwh: null,
      transaction_id: null,
    },
    usage: {
      transaction_id: 10,
      active: true,
      energy_kwh: "6.941",
      estimated_minor: 243,
      started_at: "2026-09-23T10:00:00Z",
      ended_at: null,
    },
    start_operation: {
      id: "op_start",
      status: "succeeded",
      result: { status: "Accepted" },
    },
    stop_operation: null,
  });
  mock.write.mockImplementation(async (_key: string, path: string) =>
    path.endsWith("/finalize")
      ? {
          id: "bill_one",
          status: "final",
          total_minor: 243,
          energy_kwh: "6.941",
          transaction_id: 10,
        }
      : {},
  );
  mock.capture.mockImplementation(
    async (
      _id: string,
      input: { amount_to_capture: number; application_fee_amount: number },
    ) => {
      Object.assign(mock.pi, {
        status: "succeeded",
        amount_received: input.amount_to_capture,
        application_fee_amount: input.application_fee_amount,
      });
      return mock.pi;
    },
  );
  mock.refund.mockResolvedValue({ id: "re_test" });
});
afterEach(() => vi.useRealTimers());
describe("external-funded charging settlement", () => {
  it("expires an abandoned checkout before releasing the local reservation", async () => {
    Object.assign(mock.checkout, { status: "open", payment_intent: null });
    mock.session.ivora_session_id = null;
    await reconcile("session-one");
    expect(mock.expire).toHaveBeenCalledWith(
      "cs_test",
      {},
      { idempotencyKey: "session-one:expire" },
    );
    expect(mock.session.status).toBe("canceled");
    expect(mock.operation).not.toHaveBeenCalled();
  });
  it("retains the reservation if checkout expiration races with payment or fails", async () => {
    Object.assign(mock.checkout, { status: "open", payment_intent: null });
    mock.session.ivora_session_id = null;
    mock.session.status = "awaiting_payment";
    mock.expire.mockRejectedValueOnce(new Error("Checkout changed"));
    await expect(reconcile("session-one")).rejects.toThrow("Checkout changed");
    expect(mock.session.status).toBe("awaiting_payment");
    expect(mock.operation).not.toHaveBeenCalled();
  });
  it("does not treat a checkout redirect or unverified payment as funding", async () => {
    mock.pi.status = "requires_payment_method";
    mock.session.ivora_session_id = null;
    mock.session.status = "awaiting_payment";
    await reconcile("session-one");
    expect(mock.operation).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("rejects a payment routed to another connected host", async () => {
    mock.pi.transfer_data.destination = "acct_someone_else";
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.operation).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("never captures while the physical transaction is active", async () => {
    await reconcile("session-one");
    expect(mock.session.status).toBe("charging");
    expect(mock.session.energy_kwh).toBe(6.941);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("requests a stop near the hold but waits for confirmed completion", async () => {
    mock.external.usage.estimated_minor = 2200;
    await reconcile("session-one");
    expect(mock.operation).toHaveBeenCalledWith(
      "session-one:stop",
      "charging-sessions/ext_one/stop",
    );
    expect(mock.session.status).toBe("stopping");
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("captures the immutable final bill and applies 6% to that amount", async () => {
    mock.external.usage.active = false;
    mock.external.usage.ended_at = "2026-09-23T11:00:00Z";
    await reconcile("session-one");
    expect(mock.capture).toHaveBeenCalledWith(
      "pi_test",
      { amount_to_capture: 243, application_fee_amount: 15 },
      { idempotencyKey: "session-one:capture" },
    );
    expect(mock.session).toMatchObject({
      status: "completed",
      total_cents: 243,
      fee_cents: 15,
      energy_kwh: 6.941,
    });
    await reconcile("session-one");
    expect(mock.capture).toHaveBeenCalledTimes(1);
  });
  it("recovers a captured payment after a lost response without charging twice", async () => {
    mock.external.usage.active = false;
    Object.assign(mock.pi, {
      status: "succeeded",
      amount_received: 243,
      application_fee_amount: 15,
    });
    await reconcile("session-one");
    expect(mock.session.status).toBe("completed");
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("does not silently cap an overage or capture it beyond authorization", async () => {
    mock.external.usage.active = false;
    mock.external.bill = {
      id: "bill_one",
      status: "final",
      total_minor: 2600,
      energy_kwh: "74.285",
      transaction_id: 10,
    };
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("keeps unknown physical starts in review without issuing a replacement", async () => {
    mock.external.start_operation.status = "unknown";
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.operation).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("does not capture a final bill for a different transaction", async () => {
    mock.external.usage.active = false;
    mock.external.bill = {
      id: "bill_one",
      status: "final",
      total_minor: 243,
      energy_kwh: "6.941",
      transaction_id: 999,
    };
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("recovers a canceled zero-cost authorization after a lost acknowledgement", async () => {
    mock.pi.status = "canceled";
    mock.external.usage.active = false;
    mock.external.bill = {
      id: "bill_one",
      status: "final",
      total_minor: 0,
      energy_kwh: "0",
      transaction_id: 10,
    };
    await reconcile("session-one");
    expect(mock.session).toMatchObject({
      status: "completed",
      total_cents: 0,
      fee_cents: 0,
    });
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });
  it("never declares charging complete just because its authorization expired", async () => {
    mock.pi.status = "canceled";
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.operation).toHaveBeenCalledWith(
      "session-one:stop",
      "charging-sessions/ext_one/stop",
    );
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it("does not accept an already captured payment against a zero-cost final bill", async () => {
    mock.pi.status = "succeeded";
    mock.external.usage.active = false;
    mock.external.bill = {
      id: "bill_one",
      status: "final",
      total_minor: 0,
      energy_kwh: "0",
      transaction_id: 10,
    };
    await reconcile("session-one");
    expect(mock.session.status).toBe("review");
    expect(mock.cancel).not.toHaveBeenCalled();
  });
  it("reverses both the host transfer and platform fee on a full refund", async () => {
    mock.session.status = "completed";
    mock.session.refund_requested = true;
    mock.session.total_cents = 243;
    mock.pi.status = "succeeded";
    await reconcile("session-one");
    expect(mock.refund).toHaveBeenCalledWith(
      {
        payment_intent: "pi_test",
        reverse_transfer: true,
        refund_application_fee: true,
      },
      { idempotencyKey: "session-one:refund" },
    );
    expect(mock.session).toMatchObject({
      status: "refunded",
      refund_requested: false,
    });
    await reconcile("session-one");
    expect(mock.refund).toHaveBeenCalledTimes(1);
  });
});
