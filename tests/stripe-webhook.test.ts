import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  reconcile: vi.fn(),
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
});
afterEach(() => vi.unstubAllEnvs());

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { metadata: { squid_session_id: "session-one" } } },
    ...overrides,
  });
}
function request(body: string, signature?: string) {
  return new NextRequest("https://squid.example/api/stripe/webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}
function signed(body: string, secret: string) {
  return request(
    body,
    Stripe.webhooks.generateTestHeaderString({ payload: body, secret }),
  );
}

it("accepts and reconciles a validly signed platform Checkout event", async () => {
  expect((await POST(signed(event(), "whsec_platform"))).status).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledWith("session-one");
});
it("accepts a connected-account event signed with the Connect secret", async () => {
  const body = event({ account: "acct_host" });
  expect((await POST(signed(body, "whsec_connect"))).status).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledWith("session-one");
});
it("returns 503 without checking signatures when the secret is missing", async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  const response = await POST(signed(event(), "whsec_platform"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Webhook not configured." });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("rejects a bad signature when the secret is set", async () => {
  expect((await POST(signed(event(), "whsec_wrong"))).status).toBe(400);
  expect((await POST(request(event(), "t=1,v1=bad"))).status).toBe(400);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("rejects an unsigned request when the secret is set", async () => {
  expect((await POST(request(event()))).status).toBe(400);
});
it("works without the optional Connect secret", async () => {
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "");
  expect((await POST(signed(event(), "whsec_platform"))).status).toBe(200);
  expect((await POST(signed(event(), "whsec_connect"))).status).toBe(400);
});
it("returns 503 for a verified event when the API key is missing", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  const response = await POST(signed(event(), "whsec_platform"));
  expect(response.status).toBe(503);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("ignores events from the other Stripe mode", async () => {
  const body = event({ livemode: true });
  expect((await POST(signed(body, "whsec_platform"))).status).toBe(200);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("ignores a connected event for another host's session", async () => {
  mocks.load.mockResolvedValueOnce({ stripe_account_id: "acct_other" });
  const body = event({ account: "acct_host" });
  expect((await POST(signed(body, "whsec_connect"))).status).toBe(200);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
