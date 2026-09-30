import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  load: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/server/stripe", () => ({
  stripe: () => ({ webhooks: { constructEvent: mocks.construct } }),
}));
vi.mock("@/lib/server/sessions", () => ({
  loadSession: mocks.load,
  reconcile: mocks.reconcile,
}));
import { POST } from "@/app/api/stripe/webhook/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_platform");
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connect");
  mocks.load.mockResolvedValue({ stripe_account_id: "acct_host" });
  mocks.reconcile.mockResolvedValue({});
  mocks.construct.mockImplementation((_body, signature, secret) => {
    if (
      (signature === "platform" && secret === "whsec_platform") ||
      (signature === "connected" && secret === "whsec_connect")
    )
      return {
        type: "checkout.session.completed",
        livemode: false,
        account: signature === "connected" ? "acct_host" : undefined,
        data: { object: { metadata: { squid_session_id: "session-one" } } },
      };
    throw new Error("Invalid signature");
  });
});
afterEach(() => vi.unstubAllEnvs());

function request(signature: string) {
  return new NextRequest("https://squid.example/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: "signed-body",
  });
}

it.each(["platform", "connected"])(
  "reconciles a signed %s Checkout event",
  async (scope) => {
    expect((await POST(request(scope))).status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith("session-one");
  },
);
it("rejects an invalid signature", async () => {
  expect((await POST(request("invalid"))).status).toBe(400);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("ignores a connected event for another host's session", async () => {
  mocks.load.mockResolvedValueOnce({ stripe_account_id: "acct_other" });
  expect((await POST(request("connected"))).status).toBe(200);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
