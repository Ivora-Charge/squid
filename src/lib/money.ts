export const PLATFORM_FEE_PERCENT = 6;
export function platformFee(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid money amount");
  return Math.floor((cents * PLATFORM_FEE_PERCENT + 50) / 100);
}
export function money(cents: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}
export function splitPayment(cents: number) {
  const fee = platformFee(cents);
  return { total: cents, fee, host: cents - fee };
}
export function captureAmount(total: number, authorized: number) {
  if (!Number.isSafeInteger(total) || total < 0 || total > authorized)
    throw new Error(
      "The final bill exceeds the authorized amount and needs review.",
    );
  return {
    amount_to_capture: total,
    application_fee_amount: platformFee(total),
  };
}
