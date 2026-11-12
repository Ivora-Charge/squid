import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChargeSession } from "@/lib/types";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: {} as ChargeSession,
  updates: [] as Record<string, unknown>[],
  expire: vi.fn(),
  retrieve: vi.fn(),
  sendReviewAlert: vi.fn(),
  claimed: true,
}));
vi.mock("@/lib/server/db", () => {
  class LockBusyError extends Error {}
  return {
    LockBusyError,
    checked: (result: { data: unknown }) => result.data,
    withLock: async (_key: string, run: () => Promise<unknown>) => run(),
    db: () => ({
      rpc: mock.rpc,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "host@example.com" } },
            error: null,
          }),
        },
      },
      from: () => {
        let values: Record<string, unknown> | null = null;
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          update: (v: Record<string, unknown>) => {
            values = v;
            return q;
          },
          single: async () => ({
            data: { id: "property", name: "Cabin", station_id: 1 },
            error: null,
          }),
          maybeSingle: async () => ({ data: mock.session, error: null }),
          then: (resolve: (v: unknown) => unknown) => {
            if (values) {
              if ("review_notified_at" in values && values.review_notified_at) {
                if (!mock.claimed)
                  return Promise.resolve(resolve({ data: [], error: null }));
                mock.claimed = false;
              }
              if (values.review_notified_at === null) mock.claimed = true;
              mock.updates.push(values);
              Object.assign(mock.session, values);
            }
            return Promise.resolve(
              resolve({ data: [{ id: "s" }], error: null }),
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
    checkout: { sessions: { retrieve: mock.retrieve, expire: mock.expire } },
  }),
  payoutStatus: async () => ({ id: "acct_host", ready: true }),
  paymentOptions: async () => ({ stripeAccount: "acct_host" }),
}));
vi.mock("@/lib/server/ivora", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/ivora")>()),
  durable: async (_k: string, _i: unknown, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("@/lib/server/email", () => ({
  sendReviewAlert: mock.sendReviewAlert,
}));
vi.mock("@/lib/server/security", async (original) => ({
  ...(await original<typeof import("@/lib/server/security")>()),
  issueGuestCookie: async () => undefined,
}));

import { POST } from "@/app/api/checkout/route";
import * as sessions from "@/lib/server/sessions";

const requestId = "3f0c1a52-8f0e-4c53-9d57-1c1a3a4f0b11";
function checkout(slug = "cabin", source = "203.0.113.7") {
  return POST(
    new NextRequest("https://squid.example/api/checkout", {
      method: "POST",
      headers: {
        origin: "https://squid.example",
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": source,
      },
      body: JSON.stringify({ slug, requestId }),
    }),
  );
}
let spy: ReturnType<typeof vi.spyOn>;
const NOW = Date.parse("2026-11-12T10:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private");
  vi.stubEnv("VERCEL", "1");
  mock.updates = [];
  mock.claimed = true;
  mock.rpc.mockResolvedValue({ data: true, error: null });
  spy = vi
    .spyOn(sessions, "createCheckout")
    .mockResolvedValue({ id: "s", checkout_url: "https://x" } as ChargeSession);
  mock.session = {
    id: "s",
    request_id: requestId,
    property_id: "property",
    host_id: "host",
    stripe_account_id: "acct_host",
    status: "awaiting_payment",
    rate_cents: 35,
    hold_cents: 2500,
    tariff_id: 3,
    stripe_checkout_id: "cs_test",
    stripe_payment_id: null,
    checkout_url: "https://checkout.example",
    ivora_session_id: null,
    energy_kwh: 0,
    total_cents: null,
    fee_cents: null,
    stripe_fee_cents: null,
    stop_requested: false,
    refund_requested: false,
    last_error: null,
    review_attempts: 0,
    review_notified_at: null,
    created_at: new Date(NOW - 6 * 60_000).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    started_at: null,
    ended_at: null,
  };
  mock.retrieve.mockResolvedValue({
    id: "cs_test",
    status: "open",
    payment_intent: null,
  });
});

describe("/api/checkout rate limit", () => {
  it("answers 429 and creates nothing when the quota is used up", async () => {
    mock.rpc.mockResolvedValue({ data: false, error: null });
    const response = await checkout();
    expect(mock.rpc).toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(spy).not.toHaveBeenCalled();
  });
  it("limits per address and charger, without storing either in clear", async () => {
    await checkout("cabin", "203.0.113.7");
    await checkout("cottage", "203.0.113.7");
    const keys = mock.rpc.mock.calls.map((c) => c[1].bucket_key as string);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).not.toContain("203.0.113.7");
      expect(key).not.toContain("cabin");
      expect(key).not.toContain("cottage");
    }
  });
  it("passes a request inside the quota to the checkout", async () => {
    const response = await checkout();
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("shorter hold for an unpaid checkout", () => {
  it("is a few minutes, far below the old 30", () => {
    expect(sessions.UNPAID_HOLD_MS).toBeGreaterThan(0);
    expect(sessions.UNPAID_HOLD_MS).toBeLessThanOrEqual(10 * 60_000);
  });
  it("releases an unpaid slot after the hold", async () => {
    const result = await sessions.reconcile("s");
    expect(mock.expire).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("canceled");
  });
  it("keeps a recent unpaid slot", async () => {
    mock.session.created_at = new Date(NOW - 60_000).toISOString();
    const result = await sessions.reconcile("s");
    expect(mock.expire).not.toHaveBeenCalled();
    expect(result.status).toBe("awaiting_payment");
  });
});

describe("sessions in review", () => {
  beforeEach(() => {
    mock.session.status = "review";
    mock.session.last_error = "Charger state needs operator review.";
  });
  it("counts each pass and tells the host once", async () => {
    await sessions.afterReconcile("s");
    expect(mock.session.review_attempts).toBe(1);
    expect(mock.sendReviewAlert).toHaveBeenCalledTimes(1);
    expect(mock.sendReviewAlert.mock.calls[0][0]).toBe("host@example.com");
    expect(JSON.stringify(mock.sendReviewAlert.mock.calls[0][1])).toContain(
      "Charger state needs operator review.",
    );
    await sessions.afterReconcile("s");
    expect(mock.session.review_attempts).toBe(2);
    expect(mock.sendReviewAlert).toHaveBeenCalledTimes(1);
  });
  it("tries again to notify when delivery failed", async () => {
    mock.sendReviewAlert.mockRejectedValueOnce(new Error("down"));
    await sessions.afterReconcile("s");
    expect(mock.session.review_notified_at).toBeNull();
    await sessions.afterReconcile("s");
    expect(mock.sendReviewAlert).toHaveBeenCalledTimes(2);
    expect(mock.session.review_notified_at).not.toBeNull();
  });
  it("resets the counters when the session leaves review", async () => {
    await sessions.afterReconcile("s");
    mock.session.status = "charging";
    await sessions.afterReconcile("s");
    expect(mock.session.review_attempts).toBe(0);
    expect(mock.session.review_notified_at).toBeNull();
  });
  it("drops a session from the per-minute queue after a bounded number of tries", () => {
    expect(sessions.REVIEW_RETRY_LIMIT).toBeGreaterThan(0);
    expect(sessions.REVIEW_RETRY_LIMIT).toBeLessThanOrEqual(30);
    expect(sessions.reconcileQueueFilter()).toContain(
      `review_attempts.lt.${sessions.REVIEW_RETRY_LIMIT}`,
    );
  });
});
