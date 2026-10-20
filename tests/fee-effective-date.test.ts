import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NEW_HOST_FEE_EFFECTIVE_AT,
  formatEffectiveAt,
  hostRateFor,
  parseInstant,
} from "@/lib/money";
const mock = vi.hoisted(() => ({
  user: null as { id: string; created_at: string } | null,
  // The squid_hosts row, or null when the host has not started payout setup.
  row: null as { fee_basis_points: number } | null,
  update: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) =>
          mock.user && mock.user.id === id
            ? { data: { user: mock.user }, error: null }
            : { data: { user: null }, error: { message: "User not found" } },
      },
    },
    from: (table: string) => ({
      update: (values: { fee_basis_points: number }) => ({
        eq: (_column: string, id: string) => ({
          neq: async (_c: string, rate: number) => {
            mock.update(table, id, values);
            if (mock.row && mock.row.fee_basis_points !== rate)
              mock.row.fee_basis_points = values.fee_basis_points;
            return { data: null, error: null };
          },
        }),
      }),
    }),
  }),
  checked: (value: { data: unknown }) => value.data,
  withLock: async (_key: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("@/lib/server/ivora", () => ({ durable: vi.fn(), forget: vi.fn() }));
import { newHostFeeEffectiveAt } from "@/lib/server/config";
import { hostFeeRate } from "@/lib/server/stripe";

const host = "10000000-0000-4000-8000-000000000001";
const DEFAULT = parseInstant(DEFAULT_NEW_HOST_FEE_EFFECTIVE_AT);
beforeEach(() => {
  vi.unstubAllEnvs();
  mock.user = null;
  mock.row = null;
  mock.update.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the new-host fee boundary", () => {
  it("defaults to November 1, 2026 at 00:00 UTC", () => {
    expect(DEFAULT.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(formatEffectiveAt(DEFAULT)).toBe("November 1, 2026 (00:00 UTC)");
  });
  it.each([
    ["one second before the boundary", "2026-10-31T23:59:59Z", 600],
    ["a microsecond before the boundary", "2026-10-31T23:59:59.999999Z", 600],
    ["exactly at the boundary", "2026-11-01T00:00:00Z", 1000],
    ["one second after the boundary", "2026-11-01T00:00:01Z", 1000],
    [
      "a Pacific evening that is already November 1 in UTC",
      "2026-10-31T20:00:00-07:00",
      1000,
    ],
    ["the last second of October 31 in UTC", "2026-10-31T23:59:59Z", 600],
    [
      "an Eastern morning that is still October 31 in UTC",
      "2026-11-01T01:00:00+02:00",
      600,
    ],
    ["a database timestamp", "2026-11-01 00:00:00.000001+00", 1000],
  ])("an account created %s pays its rate", (_case, createdAt, rate) => {
    expect(hostRateFor(createdAt, DEFAULT)).toBe(rate);
  });
  it("refuses to guess when the creation time is missing or invalid", () => {
    for (const createdAt of ["", "yesterday", undefined as unknown as string])
      expect(() => hostRateFor(createdAt, DEFAULT)).toThrow(/fee rate/);
  });
  it("shows a time other than midnight, always in UTC", () => {
    expect(formatEffectiveAt(parseInstant("2026-12-15T09:30:00-05:00"))).toBe(
      "December 15, 2026 (14:30 UTC)",
    );
    expect(formatEffectiveAt(parseInstant("2027-01-01T00:00:30Z"))).toBe(
      "January 1, 2027 (00:00:30 UTC)",
    );
  });
});

describe("NEW_HOST_FEE_EFFECTIVE_AT", () => {
  it("uses the default when unset or empty", () => {
    expect(newHostFeeEffectiveAt()).toEqual(DEFAULT);
    vi.stubEnv("NEW_HOST_FEE_EFFECTIVE_AT", "");
    expect(newHostFeeEffectiveAt()).toEqual(DEFAULT);
  });
  it("accepts an override with any UTC offset", () => {
    vi.stubEnv("NEW_HOST_FEE_EFFECTIVE_AT", "2026-12-01T00:00:00-05:00");
    expect(newHostFeeEffectiveAt().toISOString()).toBe(
      "2026-12-01T05:00:00.000Z",
    );
    expect(hostRateFor("2026-12-01T04:59:59Z", newHostFeeEffectiveAt())).toBe(
      600,
    );
    expect(hostRateFor("2026-12-01T05:00:00Z", newHostFeeEffectiveAt())).toBe(
      1000,
    );
  });
  it.each([
    "2026-11-01",
    "2026-11-01T00:00:00",
    "2026-11-01 00:00:00Z",
    "2026-11-01T00:00:00z",
    "2026-02-30T00:00:00Z",
    "2026-11-01T24:00:00Z",
    "2026-11-01T00:60:00Z",
    "2026-11-01T00:00:00+24:00",
    "November 1, 2026",
    " 2026-11-01T00:00:00Z",
    "1793491200000",
  ])("rejects %j instead of falling back to the default", (value) => {
    vi.stubEnv("NEW_HOST_FEE_EFFECTIVE_AT", value);
    expect(() => newHostFeeEffectiveAt()).toThrow(
      /Invalid NEW_HOST_FEE_EFFECTIVE_AT/,
    );
  });
});

describe("hostFeeRate", () => {
  it.each([
    [
      "before the effective date with a saved host row",
      "2026-10-31T23:59:59Z",
      1000,
      600,
    ],
    [
      "before the effective date without a host row",
      "2026-10-31T23:59:59Z",
      null,
      600,
    ],
    [
      "on the effective date with a saved host row",
      "2026-11-01T00:00:00Z",
      600,
      1000,
    ],
    [
      "after the effective date without a host row",
      "2026-11-01T00:00:01Z",
      null,
      1000,
    ],
  ])(
    "decides the rate from the account creation time: %s",
    async (_case, createdAt, stored, expected) => {
      mock.user = { id: host, created_at: createdAt };
      mock.row = stored === null ? null : { fee_basis_points: stored };
      expect(await hostFeeRate(host)).toBe(expected);
      // The saved record follows the decided rate; it never decides it.
      if (mock.row) expect(mock.row.fee_basis_points).toBe(expected);
      expect(mock.update).toHaveBeenCalledWith("squid_hosts", host, {
        fee_basis_points: expected,
      });
    },
  );
  it("does not depend on when it runs", async () => {
    mock.user = { id: host, created_at: "2026-10-20T08:00:00Z" };
    vi.useFakeTimers();
    for (const now of ["2026-10-20T09:00:00Z", "2026-11-05T00:00:00Z"]) {
      vi.setSystemTime(new Date(now));
      expect(await hostFeeRate(host)).toBe(600);
    }
  });
  it("follows an overridden effective date", async () => {
    vi.stubEnv("NEW_HOST_FEE_EFFECTIVE_AT", "2026-10-15T00:00:00Z");
    mock.user = { id: host, created_at: "2026-10-20T08:00:00Z" };
    expect(await hostFeeRate(host)).toBe(1000);
  });
  it("fails instead of guessing when the config is invalid", async () => {
    vi.stubEnv("NEW_HOST_FEE_EFFECTIVE_AT", "2026-11-01");
    mock.user = { id: host, created_at: "2026-10-20T08:00:00Z" };
    await expect(hostFeeRate(host)).rejects.toThrow(
      /Invalid NEW_HOST_FEE_EFFECTIVE_AT/,
    );
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("fails instead of guessing when the account cannot be loaded", async () => {
    await expect(hostFeeRate(host)).rejects.toThrow(/host account/);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
