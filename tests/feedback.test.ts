import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  workspace: vi.fn(),
  records: new Map<string, Record<string, unknown>>(),
}));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  db: () => ({ rpc: mocks.rpc, from: () => ({ upsert: mocks.upsert }) }),
  checked: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw new Error("Database unavailable");
    return result.data;
  },
}));
vi.mock("@/lib/server/admin", () => ({ authorizeWorkspace: mocks.workspace }));
import { POST } from "@/app/api/feedback/route";
import { feedbackPage } from "@/lib/server/feedback";

const id = "30000000-0000-4000-8000-000000000001";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://squid.example/api/feedback", {
    method: "POST",
    headers: {
      origin: "https://squid.example",
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "192.0.2.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const input = { id, category: "idea", message: "Please improve charger setup" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.records.clear();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private");
  vi.stubEnv("VERCEL", "1");
  mocks.user.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.upsert.mockImplementation(
    async (
      record: Record<string, unknown>,
      options: { ignoreDuplicates: boolean },
    ) => {
      if (!mocks.records.has(String(record.id)) || !options.ignoreDuplicates)
        mocks.records.set(String(record.id), record);
      return { data: null, error: null };
    },
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("feedback submission", () => {
  it("allows anonymous feedback without an email or rating and stores only the permitted fields", async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.records.get(id)).toEqual({
      ...input,
      submitted_by: null,
      tenant_id: null,
      email: null,
      rating: null,
      page_path: "/",
    });
  });
  it("normalizes the optional email and trims feedback", async () => {
    expect(
      (
        await POST(
          request({
            ...input,
            email: " Guest@Example.com ",
            message: "  Useful idea  ",
            rating: 5,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.records.get(id)).toMatchObject({
      email: "guest@example.com",
      message: "Useful idea",
      rating: 5,
    });
  });
  it("rejects invalid fields and attempts to set server-controlled ownership or status", async () => {
    for (const patch of [
      { email: "not-email" },
      { message: "  " },
      { message: "x".repeat(2001) },
      { rating: 0 },
      { rating: 6 },
      { rating: 1.5 },
      { category: "admin" },
      { tenant_id: id },
      { status: "resolved" },
    ]) {
      expect((await POST(request({ ...input, ...patch }))).status).toBe(400);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies cross-origin writes and bounds malformed and oversized bodies", async () => {
    expect(
      (await POST(request(input, { origin: "https://evil.example" }))).status,
    ).toBe(403);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(12001)))).status).toBe(413);
    expect(
      (await POST(request(input, { "content-length": "12001" }))).status,
    ).toBe(413);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("filters spam without consuming database or rate-limit writes", async () => {
    expect(
      (await POST(request({ ...input, website: "spam.example" }))).status,
    ).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("does not duplicate a retry or allow a retry ID to overwrite someone else's feedback", async () => {
    expect((await POST(request(input))).status).toBe(200);
    expect(
      (
        await POST(
          request({
            ...input,
            message: "Attempted overwrite",
            email: "another@example.com",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.records.size).toBe(1);
    expect(mocks.records.get(id)?.message).toBe(input.message);
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.anything(), {
      onConflict: "id",
      ignoreDuplicates: true,
    });
  });
  it("limits abuse with hashed source/account buckets and does not store raw IP addresses", async () => {
    mocks.user.mockResolvedValue({ id: "private-host-id" });
    expect((await POST(request(input))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "squid_take_rate_limit",
      expect.objectContaining({
        bucket_key: expect.stringMatching(/^feedback-source:[a-f0-9]{64}$/),
        quota: 10,
        period_seconds: 600,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "squid_take_rate_limit",
      expect.objectContaining({
        bucket_key: expect.stringMatching(/^feedback-account:[a-f0-9]{64}$/),
        quota: 5,
        period_seconds: 600,
      }),
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(
      /192\.0\.2\.1|private-host-id/,
    );
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(
      (
        await POST(
          request({ ...input, id: "30000000-0000-4000-8000-000000000002" }),
        )
      ).status,
    ).toBe(429);
    expect(mocks.records.size).toBe(1);
  });
  it("only reports delivery after storage succeeds and does not expose database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.upsert.mockResolvedValueOnce({
        data: null,
        error: { message: "private database details" },
      });
      const response = await POST(request(input));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Could not send your feedback. Please try again.",
      });
    } finally {
      log.mockRestore();
    }
  });
  it("binds tenant feedback to the server's workspace identity and retains the real submitter", async () => {
    const actor = { id: "real-admin-id" };
    mocks.user.mockResolvedValue(actor);
    mocks.workspace.mockResolvedValue({ host: { id: "selected-tenant-id" } });
    const req = request(
      { ...input, page: "/dashboard" },
      { "x-squid-tenant-access": "current-lease" },
    );
    expect((await POST(req)).status).toBe(200);
    expect(mocks.workspace).toHaveBeenCalledWith(actor, req);
    expect(mocks.records.get(id)).toMatchObject({
      submitted_by: actor.id,
      tenant_id: "selected-tenant-id",
    });
  });
  it("removes private IDs, query parameters, and fragments from feedback page context", async () => {
    expect(feedbackPage("/c/private-charger?secret=one#token=two")).toBe(
      "/c/[charger]",
    );
    expect(feedbackPage("/session/private-session?secret=one")).toBe(
      "/session/[session]",
    );
    expect(feedbackPage("/login/confirm#token_hash=private")).toBe(
      "/login/confirm",
    );
    expect(feedbackPage("https://evil.example/path")).toBe("/");
    await POST(
      request({ ...input, page: "/session/private-session?token=private" }),
    );
    expect(mocks.records.get(id)?.page_path).toBe("/session/[session]");
  });
});
