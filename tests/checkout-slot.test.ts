import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargeSession } from "@/lib/types";

// A small in-memory squid_sessions table, enough for createCheckout and
// reconcile, including the one-active-session unique index, plus an
// in-memory squid_take_rate_limit with the same quota semantics.
type Row = Record<string, unknown>;
const mock = vi.hoisted(() => ({
  rows: [] as Row[],
  property: {} as Row,
  checkout: { id: "cs_old", status: "open", payment_intent: null } as Record<
    string,
    unknown
  >,
  retrieve: vi.fn(),
  expire: vi.fn(),
  create: vi.fn(),
  piRetrieve: vi.fn(),
  buckets: new Map<string, number>(),
  rpc: vi.fn(),
}));
const TERMINAL = ["completed", "canceled", "refunded"];
vi.mock("@/lib/server/db", () => {
  class LockBusyError extends Error {}
  function query(table: string) {
    const filters: [string, unknown][] = [];
    let values: Row | null = null;
    let inserted: Row | null = null;
    let deleting = false;
    const matches = () =>
      mock.rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return q;
      },
      is: (k: string, v: unknown) => {
        filters.push([k, v]);
        return q;
      },
      delete: () => {
        deleting = true;
        return q;
      },
      update: (v: Row) => {
        values = v;
        return q;
      },
      insert: (v: Row) => {
        inserted = v;
        return q;
      },
      maybeSingle: async () =>
        table === "squid_properties"
          ? { data: mock.property, error: null }
          : { data: matches()[0] ?? null, error: null },
      single: async () => {
        if (table === "squid_properties")
          return { data: mock.property, error: null };
        const row = inserted!;
        if (
          mock.rows.some(
            (r) =>
              r.property_id === row.property_id &&
              !TERMINAL.includes(r.status as string),
          )
        )
          return { data: null, error: { code: "23505" } };
        const created = {
          ...base(),
          ...row,
          status: "awaiting_payment",
          stripe_checkout_id: null,
          checkout_url: null,
          created_at: new Date().toISOString(),
        };
        mock.rows.push(created);
        return { data: created, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (values) for (const r of matches()) Object.assign(r, values);
        if (deleting) {
          const gone = matches();
          mock.rows = mock.rows.filter((r) => !gone.includes(r));
        }
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    };
    return q;
  }
  return {
    LockBusyError,
    checked: (result: { data: unknown; error?: unknown }) => {
      if (result.error) throw new Error("db error");
      return result.data;
    },
    withLock: async (_key: string, run: () => Promise<unknown>) => run(),
    db: () => ({ from: query, rpc: mock.rpc }),
  };
});
vi.mock("@/lib/server/stripe", () => ({
  stripe: () => ({
    checkout: {
      sessions: {
        retrieve: mock.retrieve,
        expire: mock.expire,
        create: mock.create,
      },
    },
    paymentIntents: { retrieve: mock.piRetrieve },
  }),
  payoutStatus: async () => ({ id: "acct_host", ready: true }),
  paymentOptions: async () => ({ stripeAccount: "acct_host" }),
}));
vi.mock("@/lib/server/ivora", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/ivora")>()),
  durable: async (_k: string, _i: unknown, run: () => Promise<unknown>) =>
    run(),
  getStation: async () => ({
    id: 1,
    online: true,
    connectors: [{ id: 1, status: "Preparing" }],
  }),
  writeIvora: vi.fn(async () => {
    throw new Error("Ivora must not be called in these tests.");
  }),
}));
vi.mock("@/lib/server/email", () => ({ sendReviewAlert: vi.fn() }));
vi.mock("@/lib/server/security", async (original) => ({
  ...(await original<typeof import("@/lib/server/security")>()),
  issueGuestCookie: async () => undefined,
}));

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/checkout/route";
import * as sessions from "@/lib/server/sessions";
import { HttpError } from "@/lib/server/security";

const NOW = Date.parse("2026-11-12T10:00:00Z");
function base(): ChargeSession {
  return {
    id: "old",
    request_id: "old-request",
    property_id: "property",
    host_id: "host",
    stripe_account_id: "acct_host",
    status: "awaiting_payment",
    rate_cents: 35,
    hold_cents: 2500,
    tariff_id: 3,
    stripe_checkout_id: "cs_old",
    stripe_payment_id: null,
    checkout_url: "https://checkout.example/old",
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
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    started_at: null,
    ended_at: null,
  };
}
const oldSession = () => mock.rows.find((r) => r.id === "old")!;
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const newRequest = "9b1e5c1a-2f40-4c3e-8a51-0d6a2f1e7c42";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private");
  vi.stubEnv("VERCEL", "1");
  mock.buckets = new Map();
  mock.rpc.mockImplementation(
    async (
      name: string,
      args: { bucket_key: string; quota: number; period_seconds: number },
    ) => {
      if (name !== "squid_take_rate_limit") throw new Error(name);
      const used = mock.buckets.get(args.bucket_key) ?? 0;
      if (used >= args.quota) return { data: false, error: null };
      mock.buckets.set(args.bucket_key, used + 1);
      return { data: true, error: null };
    },
  );
  mock.property = {
    id: "property",
    host_id: "host",
    name: "Cabin",
    slug: "cabin",
    published: true,
    station_id: 1,
    connector_id: 1,
    tariff_id: 3,
    rate_cents: 35,
    hold_cents: 2500,
  };
  mock.checkout = { id: "cs_old", status: "open", payment_intent: null };
  mock.retrieve.mockImplementation(async () => mock.checkout);
  mock.expire.mockImplementation(async () => {
    mock.checkout = { ...mock.checkout, status: "expired" };
    return mock.checkout;
  });
  mock.create.mockResolvedValue({
    id: "cs_new",
    url: "https://checkout.example/new",
  });
  mock.rows = [base() as unknown as Row];
});

describe("createCheckout releases a stale unpaid slot", () => {
  it("expires the stale checkout, then inserts the new session", async () => {
    oldSession().created_at = minutesAgo(sessions.UNPAID_HOLD_MINUTES + 1);
    const created = await sessions.createCheckout("cabin", newRequest);
    expect(mock.expire).toHaveBeenCalledTimes(1);
    expect(mock.expire.mock.calls[0][0]).toBe("cs_old");
    expect(oldSession().status).toBe("canceled");
    expect(created.request_id).toBe(newRequest);
    expect(created.stripe_checkout_id).toBe("cs_new");
    expect(created.checkout_url).toBe("https://checkout.example/new");
    expect(mock.rows).toHaveLength(2);
  });
  it("turns the new guest away when the earlier guest paid meanwhile", async () => {
    oldSession().created_at = minutesAgo(sessions.UNPAID_HOLD_MINUTES + 1);
    mock.checkout = {
      id: "cs_old",
      status: "complete",
      payment_intent: "pi_old",
    };
    mock.piRetrieve.mockResolvedValue({
      id: "pi_old",
      status: "processing",
      currency: "usd",
      amount: 2500,
      amount_capturable: 0,
      capture_method: "manual",
      metadata: { squid_session_id: "old" },
      transfer_data: null,
    });
    const error = await sessions
      .createCheckout("cabin", newRequest)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect(mock.expire).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    expect(oldSession().status).toBe("awaiting_payment");
    expect(oldSession().stripe_payment_id).toBe("pi_old");
    expect(mock.rows).toHaveLength(1);
  });
  it("leaves a fresh unpaid slot alone", async () => {
    oldSession().created_at = minutesAgo(sessions.UNPAID_HOLD_MINUTES - 1);
    const error = await sessions
      .createCheckout("cabin", newRequest)
      .catch((e: unknown) => e);
    expect((error as HttpError).status).toBe(409);
    expect(mock.retrieve).not.toHaveBeenCalled();
    expect(mock.expire).not.toHaveBeenCalled();
    expect(oldSession().status).toBe("awaiting_payment");
    expect(mock.rows).toHaveLength(1);
  });
  it("derives the hold from the one minutes constant", () => {
    expect(sessions.UNPAID_HOLD_MS).toBe(sessions.UNPAID_HOLD_MINUTES * 60_000);
  });
});

// Evaluates the PostgREST `or` filter the cron sends, for the operators it
// uses (eq, lt, not.in, and(...), quoted values), against plain rows.
function splitTop(input: string) {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
function compare(actual: unknown, raw: string) {
  const value = raw.replace(/^"(.*)"$/, "$1");
  if (typeof actual === "number") return actual - Number(value);
  if (typeof actual === "string" && !Number.isNaN(Date.parse(actual)))
    return Date.parse(actual) - Date.parse(value);
  throw new Error(`Cannot compare ${String(actual)} with ${value}`);
}
function holds(condition: string, row: Row): boolean {
  if (condition.startsWith("and(") && condition.endsWith(")"))
    return splitTop(condition.slice(4, -1)).every((c) => holds(c, row));
  const match = /^([a-z_]+)\.(not\.in|in|eq|lt)\.(.*)$/.exec(condition);
  if (!match) throw new Error(`Unsupported filter: ${condition}`);
  const [, column, op, value] = match;
  const actual = row[column];
  if (op === "eq") return String(actual) === value;
  if (op === "lt") return compare(actual, value) < 0;
  const list = value.replace(/^\(|\)$/g, "").split(",");
  return op === "in"
    ? list.includes(String(actual))
    : !list.includes(String(actual));
}
const queued = (row: Partial<ChargeSession>, now = NOW) =>
  splitTop(sessions.reconcileQueueFilter(now)).some((c) =>
    holds(c, { ...base(), ...row } as unknown as Row),
  );

describe("reconcile queue filter", () => {
  it("queues active sessions and refund requests, not settled ones", () => {
    expect(queued({ status: "awaiting_payment" })).toBe(true);
    expect(queued({ status: "charging" })).toBe(true);
    expect(queued({ status: "completed" })).toBe(false);
    expect(queued({ status: "canceled" })).toBe(false);
    expect(queued({ status: "completed", refund_requested: true })).toBe(true);
  });
  it("retries a review session every pass until the limit", () => {
    expect(queued({ status: "review", review_attempts: 0 })).toBe(true);
    expect(
      queued({
        status: "review",
        review_attempts: sessions.REVIEW_RETRY_LIMIT - 1,
      }),
    ).toBe(true);
  });
  it("holds back an exhausted review session during the backoff", () => {
    expect(
      queued({
        status: "review",
        review_attempts: sessions.REVIEW_RETRY_LIMIT,
        updated_at: new Date(NOW - 60_000).toISOString(),
      }),
    ).toBe(false);
    expect(
      queued({
        status: "review",
        review_attempts: sessions.REVIEW_RETRY_LIMIT + 5,
        updated_at: new Date(
          NOW - sessions.REVIEW_BACKOFF_MS + 60_000,
        ).toISOString(),
      }),
    ).toBe(false);
  });
  it("selects an exhausted review session again after the backoff", () => {
    const exhausted = {
      status: "review" as const,
      review_attempts: sessions.REVIEW_RETRY_LIMIT + 5,
      updated_at: new Date(NOW).toISOString(),
    };
    expect(queued(exhausted, NOW)).toBe(false);
    expect(queued(exhausted, NOW + sessions.REVIEW_BACKOFF_MS + 1)).toBe(true);
    // The backoff is bounded: it never drops the session for good.
    expect(sessions.REVIEW_BACKOFF_MS).toBeLessThanOrEqual(60 * 60_000);
  });
  it("puts an exhausted session back on the slow lane after a pass", async () => {
    const row = mock.rows[0];
    Object.assign(row, {
      status: "review",
      review_attempts: sessions.REVIEW_RETRY_LIMIT,
      review_notified_at: new Date(NOW - 2 * 3600_000).toISOString(),
      updated_at: new Date(NOW - 2 * 3600_000).toISOString(),
    });
    expect(queued(row as Partial<ChargeSession>)).toBe(true);
    await sessions.afterReconcile("old");
    expect(row.review_attempts).toBe(sessions.REVIEW_RETRY_LIMIT + 1);
    expect(queued(row as Partial<ChargeSession>)).toBe(false);
    expect(
      queued(
        row as Partial<ChargeSession>,
        NOW + sessions.REVIEW_BACKOFF_MS + 1,
      ),
    ).toBe(true);
  });
});

const chargerTakes = () =>
  [...mock.buckets]
    .filter(([key]) => key.startsWith("checkout-charger:"))
    .reduce((sum, [, used]) => sum + used, 0);
function checkout(source: string, requestId: string = randomUUID()) {
  return POST(
    new NextRequest("https://squid.example/api/checkout", {
      method: "POST",
      headers: {
        origin: "https://squid.example",
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": source,
      },
      body: JSON.stringify({ slug: "cabin", requestId }),
    }),
  );
}

describe("per-charger checkout quota", () => {
  it("counts a checkout that takes the slot", async () => {
    mock.rows = [];
    const response = await checkout("203.0.113.7");
    expect(response.status).toBe(200);
    expect(chargerTakes()).toBe(1);
    expect(mock.rows).toHaveLength(1);
  });
  it("does not count a request refused because the slot is taken", async () => {
    const response = await checkout("203.0.113.7");
    expect(response.status).toBe(409);
    expect(chargerTakes()).toBe(0);
  });
  it("does not count a request refused by validation", async () => {
    const response = await POST(
      new NextRequest("https://squid.example/api/checkout", {
        method: "POST",
        headers: {
          origin: "https://squid.example",
          "Content-Type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({ slug: "cabin", requestId: "not-a-uuid" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("gives the slot back when the charger quota is used up", async () => {
    mock.rows = [];
    for (let i = 0; i < 30; i++) {
      await checkout(`198.51.100.${i}`);
      // Each guest abandons the checkout; free the slot for the next one.
      for (const r of mock.rows) r.status = "canceled";
    }
    expect(chargerTakes()).toBe(30);
    mock.create.mockClear();
    const response = await checkout("192.0.2.1");
    expect(response.status).toBe(429);
    expect(mock.create).not.toHaveBeenCalled();
    expect(
      mock.rows.filter((r) => !TERMINAL.includes(r.status as string)),
    ).toHaveLength(0);
  });
  it("does not let 6 addresses spamming refused requests lock other guests out", async () => {
    // A fresh unpaid checkout holds the slot, so every request is refused.
    oldSession().created_at = minutesAgo(1);
    const statuses: number[] = [];
    for (let a = 1; a <= 6; a++)
      for (let i = 0; i < 10; i++)
        statuses.push((await checkout(`203.0.113.${a}`)).status);
    // 5 per address reach the slot (409), the rest hit the address limit (429).
    expect(statuses.filter((s) => s === 409)).toHaveLength(30);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30);
    expect(chargerTakes()).toBe(0);
    // The slot frees up: the next guest, from another address, gets a checkout.
    oldSession().status = "canceled";
    const response = await checkout("192.0.2.50");
    expect(response.status).toBe(200);
    expect(chargerTakes()).toBe(1);
  });
});
