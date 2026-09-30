import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const host = "10000000-0000-4000-8000-000000000001",
  property = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  accountId: "acct_test" as string | undefined,
  create: vi.fn(),
  retrieve: vi.fn(),
  link: vi.fn(),
  upsert: vi.fn(),
  durable: vi.fn(),
  owned: vi.fn(),
  user: vi.fn(),
  StripeError: class extends Error {
    type = "StripeInvalidRequestError";
    code = "account_invalid";
    statusCode = 400;
    requestId = "req_fixture";
  },
}));
vi.mock("stripe", () => ({
  default: class {
    static errors = { StripeError: mocks.StripeError };
    accounts = { retrieve: mocks.retrieve };
    accountLinks = { create: mocks.link };
    v2 = { core: { accounts: { create: mocks.create } } };
  },
}));
vi.mock("@/lib/server/ivora", () => ({ durable: mocks.durable }));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  db: () => ({
    from: () => ({
      upsert: mocks.upsert,
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { stripe_account_id: mocks.accountId },
            error: null,
          }),
        }),
      }),
    }),
  }),
  withLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  checked: (value: { data: unknown }) => value.data,
}));
vi.mock("@/lib/server/properties", () => ({ ownedProperty: mocks.owned }));
import { POST } from "@/app/api/host/connect/route";
import { payoutStatus } from "@/lib/server/stripe";
import { HttpError } from "@/lib/server/security";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = "acct_test";
  mocks.create.mockResolvedValue({ id: "acct_new" });
  mocks.retrieve.mockResolvedValue({
    charges_enabled: false,
    payouts_enabled: true,
    capabilities: { transfers: "active" },
  });
  mocks.upsert.mockResolvedValue({ data: null, error: null });
  mocks.durable.mockImplementation(
    async (_key: string, _input: unknown, execute: () => Promise<unknown>) =>
      execute(),
  );
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  mocks.user.mockResolvedValue({ id: host, email: "host@example.invalid" });
  mocks.owned.mockResolvedValue({ id: property });
  mocks.link.mockResolvedValue({
    url: "https://connect.stripe.com/setup/test",
  });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown) {
  return new NextRequest("https://squid.example/api/host/connect", {
    method: "POST",
    headers: {
      origin: "https://squid.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("returns hosts to their saved charger on both Stripe return and refresh", async () => {
  expect((await POST(request({ propertyId: property }))).status).toBe(200);
  expect(mocks.owned).toHaveBeenCalledWith(host, property);
  expect(mocks.link).toHaveBeenCalledWith(
    expect.objectContaining({
      account: "acct_test",
      return_url: `https://squid.example/dashboard?setup=${property}`,
      refresh_url: `https://squid.example/dashboard?setup=${property}`,
    }),
  );
});
it("keeps normal settings onboarding working", async () => {
  expect((await POST(request({}))).status).toBe(200);
  expect(mocks.link).toHaveBeenCalledWith(
    expect.objectContaining({
      return_url: "https://squid.example/dashboard?tab=settings",
    }),
  );
});
it("creates an Accounts v2 Express recipient for destination charges with a fresh key", async () => {
  mocks.accountId = undefined;
  expect((await POST(request({ propertyId: property }))).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      contact_email: "host@example.invalid",
      dashboard: "express",
      identity: { country: "US" },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      defaults: expect.objectContaining({
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      }),
    }),
    { idempotencyKey: `squid:connect:${host}:v2` },
  );
  expect(mocks.durable).toHaveBeenCalledWith(
    `squid:connect:${host}:v2`,
    { hostId: host, email: "host@example.invalid" },
    expect.any(Function),
    true,
  );
  expect(mocks.upsert).toHaveBeenCalledWith({
    id: host,
    stripe_account_id: "acct_new",
  });
  expect(mocks.link).toHaveBeenCalledWith(
    expect.objectContaining({ account: "acct_new" }),
  );
});
it("allows a recipient account to publish after transfers and payouts activate", async () => {
  expect(await payoutStatus(host)).toEqual({ id: "acct_test", ready: true });
  mocks.retrieve.mockResolvedValueOnce({
    charges_enabled: false,
    payouts_enabled: true,
    capabilities: { transfers: "inactive" },
  });
  expect(await payoutStatus(host)).toEqual({ id: "acct_test", ready: false });
});
it("returns a useful error without exposing Stripe's response details", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.link.mockRejectedValueOnce(
    new mocks.StripeError("Sensitive processor response"),
  );
  try {
    const response = await POST(request({ propertyId: property }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "Stripe payout setup is unavailable. Your charger is saved; please contact Squid support.",
    });
    expect(logged).toHaveBeenCalledWith(
      "[Squid Stripe Connect]",
      expect.objectContaining({
        stage: "link",
        code: "account_invalid",
        requestId: "req_fixture",
      }),
    );
  } finally {
    logged.mockRestore();
  }
});
it("checks ownership and rejects arbitrary return URLs before creating a link", async () => {
  mocks.owned.mockRejectedValue(new HttpError(404, "Charger not found."));
  expect((await POST(request({ propertyId: property }))).status).toBe(404);
  expect(
    (await POST(request({ propertyId: "https://evil.example" }))).status,
  ).toBe(400);
  expect(mocks.link).not.toHaveBeenCalled();
});
