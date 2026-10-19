// Squid's application fee, in basis points of the final bill. Each host keeps
// the rate set when their host record was created, and every session
// snapshots its host's rate at checkout.
export const LEGACY_FEE_BASIS_POINTS = 600;
export const NEW_HOST_FEE_BASIS_POINTS = 1000;
export const FEE_BASIS_POINTS = [
  LEGACY_FEE_BASIS_POINTS,
  NEW_HOST_FEE_BASIS_POINTS,
] as const;
export type FeeBasisPoints = (typeof FEE_BASIS_POINTS)[number];
// Stripe's standard US card rate, passed through to hosts at cost.
export const STRIPE_FEE_BASIS_POINTS = 290;
export const STRIPE_FEE_PERCENT = STRIPE_FEE_BASIS_POINTS / 100;
export const STRIPE_FEE_FIXED_CENTS = 30;
export const MINIMUM_CHARGE_CENTS = 50;
function assertMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid money amount");
}
function assertRate(basisPoints: number) {
  if (!(FEE_BASIS_POINTS as readonly number[]).includes(basisPoints))
    throw new Error("Invalid Squid fee rate");
}
// A missing or unknown rate is a configuration error, never a silent default.
export function feeRate(basisPoints: unknown): FeeBasisPoints {
  assertRate(basisPoints as number);
  return basisPoints as FeeBasisPoints;
}
export function feePercent(basisPoints: number) {
  assertRate(basisPoints);
  return `${basisPoints / 100}%`;
}
// Squid's fee, rounded half up to whole cents.
export function platformFee(cents: number, basisPoints: number) {
  assertMoney(cents);
  assertRate(basisPoints);
  return Math.floor((cents * basisPoints + 5000) / 10000);
}
// Stripe's processing fee on a charge, rounded half up to whole cents. A zero
// bill is never charged, and the host's share is never pushed below zero.
export function processingFee(cents: number, basisPoints: number) {
  assertMoney(cents);
  if (cents === 0) return 0;
  const estimate =
    Math.floor((cents * STRIPE_FEE_BASIS_POINTS + 5000) / 10000) +
    STRIPE_FEE_FIXED_CENTS;
  return Math.min(cents - platformFee(cents, basisPoints), estimate);
}
// Stripe bills the host directly for direct charges. Legacy destination
// charges collected the processing fee through Squid's application fee.
export function applicationFee(
  cents: number,
  basisPoints: number,
  direct = true,
) {
  return (
    platformFee(cents, basisPoints) +
    (direct ? 0 : processingFee(cents, basisPoints))
  );
}
export function money(cents: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}
export function splitPayment(cents: number, basisPoints: number) {
  const fee = platformFee(cents, basisPoints);
  const processing = processingFee(cents, basisPoints);
  return { total: cents, fee, processing, host: cents - fee - processing };
}
export function captureAmount(
  total: number,
  authorized: number,
  basisPoints: number,
  direct = true,
) {
  if (!Number.isSafeInteger(total) || total < 0 || total > authorized)
    throw new Error(
      "The final bill exceeds the authorized amount and needs review.",
    );
  return {
    amount_to_capture: total,
    application_fee_amount: applicationFee(total, basisPoints, direct),
  };
}
