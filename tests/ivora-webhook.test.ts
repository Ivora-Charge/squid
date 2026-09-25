import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  events: new Set<string>(),
  sessions: new Map<string, string>(),
  reconcile: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", async (original) => {
  const actual = await original<typeof import("next/server")>();
  return {
    ...actual,
    after: (work: () => unknown) => {
      mocks.after(work);
      void work();
    },
  };
});
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async (row: { id: string }) => {
        if (mocks.events.has(row.id)) return { error: { code: "23505" } };
        mocks.events.add(row.id);
        return { data: null, error: null };
      },
      select: () => ({
        eq: (_field: string, value: string) => ({
          maybeSingle: async () => ({
            data:
              table === "squid_sessions" && mocks.sessions.has(value)
                ? { id: mocks.sessions.get(value) }
                : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/server/sessions", () => ({ reconcile: mocks.reconcile }));
import { POST } from "@/app/api/ivora/webhook/route";
const secret = "whsec_fixture";
function deliver(event: unknown, options: { signature?: string } = {}) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature =
    options.signature ??
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  return POST(
    new NextRequest("https://squid.example/api/ivora/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ivora-Signature": signature,
      },
      body,
    }),
  );
}
const statusChanged = {
  id: "evt_1",
  type: "charging_session.status_changed",
  tenant_id: 18,
  resource_id: "ecs_1",
  created_at: "2026-09-24T12:00:00Z",
  data: {
    session_id: "ecs_1",
    status: "awaiting_bill",
    previous_status: "charging",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("IVORA_WEBHOOK_SECRET", secret);
  vi.stubEnv("IVORA_TENANT_ID", "18");
  mocks.events.clear();
  mocks.sessions.clear();
  mocks.sessions.set("ecs_1", "session-one");
  mocks.reconcile.mockResolvedValue({ id: "session-one" });
});
afterEach(() => vi.unstubAllEnvs());
describe("Ivora webhook", () => {
  it("acknowledges a signed status change and reconciles the session afterwards", async () => {
    const response = await deliver(statusChanged);
    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith("session-one");
  });
  it("rejects unsigned, forged, and stale deliveries without touching sessions", async () => {
    expect((await deliver(statusChanged, { signature: "" })).status).toBe(401);
    expect(
      (await deliver(statusChanged, { signature: `t=1,v1=${"0".repeat(64)}` }))
        .status,
    ).toBe(401);
    const old = Math.floor(Date.now() / 1000) - 3600;
    const body = JSON.stringify(statusChanged);
    const stale = `t=${old},v1=${createHmac("sha256", secret).update(`${old}.${body}`).digest("hex")}`;
    expect((await deliver(statusChanged, { signature: stale })).status).toBe(
      400,
    );
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("processes a redelivered event only once", async () => {
    await deliver(statusChanged);
    const again = await deliver(statusChanged);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
  it("ignores other tenants, unknown sessions, and events without a session", async () => {
    expect(
      (await deliver({ ...statusChanged, id: "evt_2", tenant_id: 19 })).status,
    ).toBe(400);
    const unknown = await deliver({
      ...statusChanged,
      id: "evt_3",
      data: { session_id: "ecs_missing" },
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ received: true, unknown: true });
    const operation = await deliver({
      id: "evt_4",
      type: "operation.completed",
      tenant_id: 18,
      resource_id: "op_1",
      data: { operation: { id: "op_1", status: "succeeded" } },
    });
    expect(operation.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("accepts a finalized bill that names the session inside the payload", async () => {
    const response = await deliver({
      id: "evt_5",
      type: "bill.finalized",
      tenant_id: 18,
      resource_id: "bill_1",
      data: { bill: { id: "bill_1" }, session_id: "ecs_1" },
    });
    expect(response.status).toBe(202);
    expect(mocks.reconcile).toHaveBeenCalledWith("session-one");
  });
  it("refuses to run without a configured secret", async () => {
    vi.stubEnv("IVORA_WEBHOOK_SECRET", "");
    expect((await deliver(statusChanged)).status).toBe(503);
  });
});
