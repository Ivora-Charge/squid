import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const host = "10000000-0000-4000-8000-000000000001",
  property = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  link: vi.fn(),
  owned: vi.fn(),
  user: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    accountLinks = { create: mocks.link };
  },
}));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  db: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { stripe_account_id: "acct_test" },
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
import { HttpError } from "@/lib/server/security";
beforeEach(() => {
  vi.clearAllMocks();
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
it("checks ownership and rejects arbitrary return URLs before creating a link", async () => {
  mocks.owned.mockRejectedValue(new HttpError(404, "Charger not found."));
  expect((await POST(request({ propertyId: property }))).status).toBe(404);
  expect(
    (await POST(request({ propertyId: "https://evil.example" }))).status,
  ).toBe(400);
  expect(mocks.link).not.toHaveBeenCalled();
});
