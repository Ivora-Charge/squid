import { describe, it, expect } from "vitest";
import { platformFee, splitPayment, captureAmount } from "@/lib/money";
describe("6% Connect fee", () => {
  it.each([
    [1000, 60, 940],
    [243, 15, 228],
    [2500, 150, 2350],
    [0, 0, 0],
    [1, 0, 1],
    [25, 2, 23],
  ])(
    "splits %i cents into %i platform and %i host cents",
    (total, fee, host) => {
      expect(splitPayment(total)).toEqual({ total, fee, host });
    },
  );
  it("conserves every cent across all supported hold amounts", () => {
    for (let amount = 0; amount <= 10000; amount++) {
      const result = splitPayment(amount);
      expect(result.fee + result.host).toBe(amount);
    }
  });
  it("captures the actual bill, with 6% of that bill instead of 6% of the hold", () => {
    expect(captureAmount(243, 2500)).toEqual({
      amount_to_capture: 243,
      application_fee_amount: 15,
    });
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid money %s", (amount) => {
    expect(() => platformFee(amount)).toThrow();
  });
  it("requires reconciliation when metered cost exceeds the hold", () => {
    expect(() => captureAmount(2501, 2500)).toThrow(/exceeds/);
  });
});
