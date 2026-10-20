import { describe, it, expect } from "vitest";
import {
  applicationFee,
  captureAmount,
  feePercent,
  feeRate,
  LEGACY_FEE_BASIS_POINTS,
  NEW_HOST_FEE_BASIS_POINTS,
  platformFee,
  processingFee,
  splitPayment,
} from "@/lib/money";
const LEGACY = LEGACY_FEE_BASIS_POINTS;
const NEW = NEW_HOST_FEE_BASIS_POINTS;
describe("Connect fees: Squid's per-host rate, Stripe's 2.9% + 30¢ passed to the host", () => {
  it("uses 6% for existing hosts and 10% for new hosts", () => {
    expect(LEGACY).toBe(600);
    expect(NEW).toBe(1000);
    expect(feePercent(LEGACY)).toBe("6%");
    expect(feePercent(NEW)).toBe("10%");
  });
  it.each([
    [LEGACY, 1000, 60, 59, 881],
    [LEGACY, 243, 15, 37, 191],
    [LEGACY, 2500, 150, 103, 2247],
    [LEGACY, 50, 3, 31, 16],
    [LEGACY, 0, 0, 0, 0],
    [NEW, 1000, 100, 59, 841],
    [NEW, 243, 24, 37, 182],
    [NEW, 2500, 250, 103, 2147],
    [NEW, 50, 5, 31, 14],
    [NEW, 0, 0, 0, 0],
  ])(
    "at %i basis points splits %i cents into %i Squid, %i Stripe, and %i host cents",
    (rate, total, fee, processing, host) => {
      expect(splitPayment(total, rate)).toEqual({
        total,
        fee,
        processing,
        host,
      });
      expect(applicationFee(total, rate)).toBe(fee);
      expect(applicationFee(total, rate, false)).toBe(fee + processing);
    },
  );
  it.each([
    [LEGACY, 25, 2], // 1.5 rounds up
    [LEGACY, 24, 1], // 1.44 rounds down
    [LEGACY, 1025, 62], // 61.5 rounds up
    [NEW, 5, 1], // 0.5 rounds up
    [NEW, 4, 0], // 0.4 rounds down
    [NEW, 245, 25], // 24.5 rounds up
    [NEW, 244, 24], // 24.4 rounds down
  ])(
    "rounds %i basis points of %i cents half up to %i cents",
    (rate, total, fee) => {
      expect(platformFee(total, rate)).toBe(fee);
    },
  );
  it.each([LEGACY, NEW])(
    "conserves every cent and never leaves the host negative at %i basis points",
    (rate) => {
      for (let amount = 0; amount <= 10000; amount++) {
        const result = splitPayment(amount, rate);
        expect(result.fee + result.processing + result.host).toBe(amount);
        expect(result.host).toBeGreaterThanOrEqual(0);
      }
    },
  );
  it("charges only Squid's fee to the host as a direct-charge application fee", () => {
    expect(captureAmount(243, 2500, LEGACY)).toEqual({
      amount_to_capture: 243,
      application_fee_amount: 15,
    });
    expect(captureAmount(243, 2500, NEW)).toEqual({
      amount_to_capture: 243,
      application_fee_amount: 24,
    });
    expect(captureAmount(243, 2500, LEGACY, false).application_fee_amount).toBe(
      52,
    );
    expect(captureAmount(243, 2500, NEW, false).application_fee_amount).toBe(
      61,
    );
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid money %s", (amount) => {
    expect(() => platformFee(amount, NEW)).toThrow();
    expect(() => processingFee(amount, NEW)).toThrow();
  });
  it.each([0, 599, 800, 1001, 10000, NaN, 6, 0.06, null, undefined, "1000"])(
    "rejects an unknown fee rate %s instead of guessing",
    (rate) => {
      expect(() => feeRate(rate)).toThrow(/fee rate/);
      expect(() => platformFee(1000, rate as number)).toThrow(/fee rate/);
      expect(() => captureAmount(1000, 2500, rate as number)).toThrow();
    },
  );
  it("accepts only the stored rates", () => {
    expect(feeRate(600)).toBe(600);
    expect(feeRate(1000)).toBe(1000);
  });
  it("requires reconciliation when metered cost exceeds the hold", () => {
    expect(() => captureAmount(2501, 2500, NEW)).toThrow(/exceeds/);
  });
});
