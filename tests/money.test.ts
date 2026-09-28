import { describe, it, expect } from "vitest";
import {
  applicationFee,
  captureAmount,
  platformFee,
  processingFee,
  splitPayment,
} from "@/lib/money";
describe("Connect fees: 6% for Squid, Stripe's 2.9% + 30¢ passed to the host", () => {
  it.each([
    [1000, 60, 59, 881],
    [243, 15, 37, 191],
    [2500, 150, 103, 2247],
    [50, 3, 31, 16],
    [0, 0, 0, 0],
  ])(
    "splits %i cents into %i Squid, %i Stripe, and %i host cents",
    (total, fee, processing, host) => {
      expect(splitPayment(total)).toEqual({ total, fee, processing, host });
      expect(applicationFee(total)).toBe(fee + processing);
    },
  );
  it("conserves every cent and never leaves the host negative", () => {
    for (let amount = 0; amount <= 10000; amount++) {
      const result = splitPayment(amount);
      expect(result.fee + result.processing + result.host).toBe(amount);
      expect(result.host).toBeGreaterThanOrEqual(0);
    }
  });
  it("captures the actual bill with both fees taken from that bill, not the hold", () => {
    expect(captureAmount(243, 2500)).toEqual({
      amount_to_capture: 243,
      application_fee_amount: 52,
    });
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid money %s", (amount) => {
    expect(() => platformFee(amount)).toThrow();
    expect(() => processingFee(amount)).toThrow();
  });
  it("requires reconciliation when metered cost exceeds the hold", () => {
    expect(() => captureAmount(2501, 2500)).toThrow(/exceeds/);
  });
});
