import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChargeSession } from "@/lib/types";
const mocks = vi.hoisted(() => ({
  session: {} as ChargeSession,
  reconcile: vi.fn(),
  guest: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("@/lib/server/db", async (original) => ({
  ...(await original<typeof import("@/lib/server/db")>()),
  db: () => ({
    from: () => ({
      update: (values: Partial<ChargeSession>) => ({
        eq: async () => {
          mocks.writes(values);
          Object.assign(mocks.session, values);
          return { data: null, error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/server/security", async (original) => ({
  ...(await original<typeof import("@/lib/server/security")>()),
  requireGuest: mocks.guest,
}));
vi.mock("@/lib/server/sessions", async (original) => ({
  ...(await original<typeof import("@/lib/server/sessions")>()),
  reconcile: mocks.reconcile,
  loadSession: async () => mocks.session,
}));
import { POST } from "@/app/api/sessions/[id]/route";
import { LockBusyError } from "@/lib/server/db";
import { HttpError } from "@/lib/server/security";
const id = "20000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  mocks.session = {
    id,
    status: "charging",
    energy_kwh: 0.028,
    stop_requested: false,
    stripe_payment_id: "pi_private",
  } as ChargeSession;
  mocks.guest.mockResolvedValue(undefined);
  mocks.reconcile.mockRejectedValue(new LockBusyError());
});
afterEach(() => vi.unstubAllEnvs());
function request(action: string, origin = "https://squid.example") {
  return new NextRequest(`https://squid.example/api/sessions/${id}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}
const context = () => ({ params: Promise.resolve({ id }) });
it("returns confirmed session data when another worker is reconciling", async () => {
  const response = await POST(request("sync"), context());
  expect(response.status).toBe(202);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.session).toMatchObject({
    id,
    status: "charging",
    energy_kwh: 0.028,
  });
  expect(body.error).toBeUndefined();
  expect(body.session.stripe_payment_id).toBeUndefined();
  expect(mocks.writes).not.toHaveBeenCalled();
});
it("persists and acknowledges a stop request while reconciliation is busy", async () => {
  const response = await POST(request("stop"), context());
  expect(response.status).toBe(202);
  expect(mocks.writes).toHaveBeenCalledWith({ stop_requested: true });
  expect((await response.json()).session).toMatchObject({
    status: "charging",
    stop_requested: true,
  });
});
it("does not hide a real reconciliation failure as a busy session", async () => {
  mocks.reconcile.mockRejectedValue(new Error("private processor failure"));
  const response = await POST(request("sync"), context());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private processor failure");
});
it("checks origin and guest access before acknowledging or storing a stop", async () => {
  expect(
    (await POST(request("stop", "https://evil.example"), context())).status,
  ).toBe(403);
  mocks.guest.mockRejectedValue(
    new HttpError(403, "Open your charging browser."),
  );
  expect((await POST(request("stop"), context())).status).toBe(403);
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.writes).not.toHaveBeenCalled();
});
