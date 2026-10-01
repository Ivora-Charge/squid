import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  from: vi.fn(),
  access: vi.fn(),
  getUser: vi.fn(),
  audit: vi.fn(),
  rpc: vi.fn(),
  setCookie: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  jar: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({ value: mocks.jar.get(name) }),
    set: mocks.setCookie,
  }),
}));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  auth: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: await mocks.user() },
        error: null,
      }),
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
  db: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { admin: { getUserById: mocks.getUser } },
  }),
  checked: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw new Error("Database unavailable");
    return result.data;
  },
}));
import {
  accessTokenHash,
  authorizeWorkspace,
  endTenantAccess,
  hostContext,
  isAdmin,
  requireAdmin,
  startTenantAccess,
  TENANT_COOKIE,
} from "@/lib/server/admin";
import { requireHost } from "@/lib/server/security";
import { GET as adminData } from "@/app/api/admin/data/route";
import { POST as tenantAccess } from "@/app/api/admin/tenant-access/route";
import { POST as feedbackStatus } from "@/app/api/admin/feedback/[id]/route";
import { PATCH as password } from "@/app/auth/password/route";
import { POST as logout } from "@/app/auth/logout/route";

const owner = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "mingcan@ivoracharge.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
} as User;
const tenant = {
  ...owner,
  id: "10000000-0000-4000-8000-000000000002",
  email: "host@example.com",
} as User;
const leaseId = "20000000-0000-4000-8000-000000000001";
const rawToken = "a".repeat(64);
function lease(overrides = {}) {
  return {
    id: leaseId,
    actor_id: owner.id,
    tenant_id: tenant.id,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    ended_at: null,
    ...overrides,
  };
}
function request(
  path: string,
  body?: unknown,
  access?: string,
  origin = "https://squid.example",
) {
  return new NextRequest(`https://squid.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(access ? { "x-squid-tenant-access": access } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.jar.clear();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  mocks.user.mockResolvedValue(owner);
  mocks.access.mockResolvedValue({ data: lease(), error: null });
  mocks.getUser.mockResolvedValue({ data: { user: tenant }, error: null });
  mocks.audit.mockResolvedValue({ data: null, error: null });
  mocks.rpc.mockResolvedValue({ data: leaseId, error: null });
  mocks.setCookie.mockImplementation((name: string, value: string) =>
    mocks.jar.set(name, value),
  );
  mocks.from.mockImplementation((table: string) => {
    if (table === "squid_admin_audit") return { insert: mocks.audit };
    if (table !== "squid_tenant_access")
      throw new Error(`Unexpected table ${table}`);
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      gt: () => query,
      maybeSingle: mocks.access,
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("verified administrator identity", () => {
  it("requires the confirmed account email and ignores user-editable role metadata", async () => {
    expect(isAdmin({ ...owner, email: "Mingcan@IvoraCharge.com" })).toBe(true);
    expect(isAdmin({ ...owner, email_confirmed_at: undefined })).toBe(false);
    expect(
      isAdmin({
        ...tenant,
        user_metadata: { role: "admin", email: owner.email },
      } as User),
    ).toBe(false);
    mocks.user.mockResolvedValue(tenant);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    mocks.user.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  });
  it("cannot grant tenant access to an ordinary host with a stolen lease cookie", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    mocks.user.mockResolvedValue(tenant);
    expect(
      await requireHost(request("/api/host/properties", {}, "self")),
    ).toEqual(tenant);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("retains the actual admin identity while using the tenant's host identity", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    expect((await hostContext(owner)).host).toEqual(tenant);
    expect(await requireAdmin()).toEqual(owner);
    expect(
      await requireHost(request("/api/host/properties", {}, leaseId)),
    ).toEqual(tenant);
  });
});

describe("tenant scope and leases", () => {
  it("rejects malformed, missing, expired, revoked, and actor-mismatched leases", async () => {
    mocks.jar.set(TENANT_COOKIE, "forged");
    await expect(hostContext(owner)).rejects.toMatchObject({ status: 409 });
    expect(mocks.access).not.toHaveBeenCalled();
    mocks.jar.set(TENANT_COOKIE, rawToken);
    for (const data of [
      null,
      lease({ actor_id: tenant.id }),
      lease({ expires_at: "invalid" }),
      lease({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      lease({ ended_at: new Date().toISOString() }),
    ]) {
      mocks.access.mockResolvedValueOnce({ data, error: null });
      await expect(hostContext(owner)).rejects.toMatchObject({ status: 409 });
    }
  });
  it("rejects deleted or mismatched target accounts", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    for (const user of [null, owner, { ...tenant, id: "different" }]) {
      mocks.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      await expect(hostContext(owner)).rejects.toMatchObject({ status: 409 });
    }
  });
  it("blocks stale tabs and missing workspace headers before any tenant action", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    for (const expected of [undefined, "self", "old-lease"]) {
      await expect(
        authorizeWorkspace(
          owner,
          request("/api/host/properties", {}, expected),
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
    mocks.jar.clear();
    await expect(
      authorizeWorkspace(owner, request("/api/host/properties", {}, leaseId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("records tenant request intent without bodies, query strings, or credentials", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    await authorizeWorkspace(
      owner,
      request(
        "/api/host/refund?token=private",
        { password: "secret" },
        leaseId,
      ),
    );
    expect(mocks.audit).toHaveBeenCalledWith({
      actor_id: owner.id,
      tenant_id: tenant.id,
      access_id: leaseId,
      event: "tenant_request",
      method: "POST",
      path: "/api/host/refund",
    });
    mocks.audit.mockResolvedValueOnce({
      data: null,
      error: { message: "unavailable" },
    });
    await expect(
      authorizeWorkspace(owner, request("/api/host/refund", {}, leaseId)),
    ).rejects.toThrow("Database unavailable");
  });
  it("stores only a hash of a fresh lease secret and uses a private one-hour cookie", async () => {
    await startTenantAccess(owner, tenant.id, "Support request");
    const [name, token, options] = mocks.setCookie.mock.calls[0];
    expect(name).toBe(TENANT_COOKIE);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("squid_start_tenant_access", {
      admin_id: owner.id,
      target_id: tenant.id,
      access_token_hash: accessTokenHash(token),
      access_reason: "Support request",
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });
  it("does not issue a lease for a nonadmin, self, missing tenant, or failed database transaction", async () => {
    await expect(
      startTenantAccess(tenant, owner.id, "Support"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      startTenantAccess(owner, owner.id, "Support"),
    ).rejects.toMatchObject({ status: 400 });
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      startTenantAccess(owner, tenant.id, "Support"),
    ).rejects.toMatchObject({ status: 404 });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    await expect(
      startTenantAccess(owner, tenant.id, "Support"),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
  it("revokes access and clears its cookie even if storage fails", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    await endTenantAccess(owner);
    expect(mocks.rpc).toHaveBeenCalledWith("squid_end_tenant_access", {
      admin_id: owner.id,
      access_token_hash: accessTokenHash(rawToken),
    });
    expect(mocks.setCookie).toHaveBeenLastCalledWith(
      TENANT_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, httpOnly: true }),
    );
    mocks.jar.set(TENANT_COOKIE, rawToken);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(endTenantAccess(owner)).rejects.toThrow();
    expect(mocks.jar.get(TENANT_COOKIE)).toBe("");
  });
  it("blocks account password changes during tenant access and revokes access on logout", async () => {
    mocks.jar.set(TENANT_COOKIE, rawToken);
    const req = new NextRequest("https://squid.example/auth/password", {
      method: "PATCH",
      headers: {
        origin: "https://squid.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "A new example password 47!" }),
    });
    expect((await password(req)).status).toBe(409);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect((await logout(request("/auth/logout", {}))).status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.jar.get(TENANT_COOKIE)).toBe("");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "squid_end_tenant_access",
      expect.objectContaining({ admin_id: owner.id }),
    );
  });
});

describe("admin HTTP boundaries", () => {
  it("denies anonymous and ordinary hosts before reading admin data or starting access", async () => {
    for (const [actor, status] of [
      [null, 401],
      [tenant, 403],
      [{ ...owner, email_confirmed_at: undefined }, 403],
    ] as const) {
      mocks.user.mockResolvedValue(actor);
      expect((await adminData(request("/api/admin/data"))).status).toBe(status);
      expect(
        (
          await tenantAccess(
            request("/api/admin/tenant-access", {
              action: "start",
              tenantId: tenant.id,
              reason: "Support",
            }),
          )
        ).status,
      ).toBe(status);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin access, malformed IDs, and injected role fields", async () => {
    const path = "/api/admin/tenant-access";
    expect(
      (
        await tenantAccess(
          request(path, { action: "end" }, undefined, "https://evil.example"),
        )
      ).status,
    ).toBe(403);
    for (const body of [
      { action: "start", tenantId: "not-a-uuid", reason: "Support" },
      { action: "end", actorId: tenant.id },
      { action: "start", tenantId: tenant.id, reason: "x" },
    ]) {
      expect((await tenantAccess(request(path, body))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates feedback status and uses the authenticated actor for its audited update", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    const context = { params: Promise.resolve({ id }) };
    expect(
      (
        await feedbackStatus(
          request(`/api/admin/feedback/${id}`, { status: "deleted" }),
          context,
        )
      ).status,
    ).toBe(400);
    const response = await feedbackStatus(
      request(`/api/admin/feedback/${id}`, { status: "resolved" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("squid_admin_feedback_status", {
      admin_id: owner.id,
      feedback_id: id,
      new_status: "resolved",
    });
  });
});
