export const PLATFORM_FEE_PERCENT = 6;
// Stripe's standard US card rate, passed through to hosts at cost.
export const STRIPE_FEE_BASIS_POINTS = 290;
export const STRIPE_FEE_PERCENT = STRIPE_FEE_BASIS_POINTS / 100;
export const STRIPE_FEE_FIXED_CENTS = 30;
export const MINIMUM_CHARGE_CENTS = 50;
function assertMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid money amount");
}
export function platformFee(cents: number) {
  assertMoney(cents);
  return Math.floor((cents * PLATFORM_FEE_PERCENT + 50) / 100);
}
// Stripe's processing fee on a charge, rounded half up to whole cents. A zero
// bill is never charged, and the host's share is never pushed below zero.
export function processingFee(cents: number) {
  assertMoney(cents);
  if (cents === 0) return 0;
  const estimate =
    Math.floor((cents * STRIPE_FEE_BASIS_POINTS + 5000) / 10000) +
    STRIPE_FEE_FIXED_CENTS;
  return Math.min(cents - platformFee(cents), estimate);
}
// The whole Connect application fee: Squid's share plus Stripe's fee.
export function applicationFee(cents: number) {
  return platformFee(cents) + processingFee(cents);
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
  const processing = processingFee(cents);
  return { total: cents, fee, processing, host: cents - fee - processing };
}
export function captureAmount(total: number, authorized: number) {
  if (!Number.isSafeInteger(total) || total < 0 || total > authorized)
    throw new Error(
      "The final bill exceeds the authorized amount and needs review.",
    );
  return {
    amount_to_capture: total,
    application_fee_amount: applicationFee(total),
  };
}
