import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  generate: vi.fn(),
  otp: vi.fn(),
  verify: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    rpc: mocks.rpc,
    auth: { admin: { generateLink: mocks.generate } },
  }),
  auth: async () => ({
    auth: { signInWithOtp: mocks.otp, verifyOtp: mocks.verify },
  }),
  user: async () => null,
}));
import { POST as login } from "@/app/auth/login/route";
import { GET as openLink, POST as confirm } from "@/app/auth/confirm/route";
import { signInEmail } from "@/lib/server/email";
const token = "a".repeat(64);
function request(
  path: string,
  body: unknown,
  origin = "https://squid.example",
) {
  return new NextRequest(`https://squid.example${path}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-signing-key");
  vi.stubEnv("RESEND_API_KEY", "re_test_private");
  vi.stubEnv("RESEND_FROM_EMAIL", "Squid by Ivora <hello@squidcharge.io>");
  vi.stubEnv("VERCEL", "1");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.generate.mockResolvedValue({
    data: { properties: { hashed_token: token } },
    error: null,
  });
  mocks.otp.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ id: "email_test" }), { status: 200 }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Squid-owned Resend sign-in", () => {
  it("sends a branded link only to the validated recipient and returns no token", async () => {
    const response = await login(
      request("/auth/login", { email: " Host@Example.com " }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.generate).toHaveBeenCalledWith({
      type: "magiclink",
      email: "host@example.com",
      options: { redirectTo: "https://squid.example/login/confirm" },
    });
    expect(mocks.otp).not.toHaveBeenCalled();
    const [url, options] = mocks.fetch.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(url).toBe("https://api.resend.com/emails");
    expect(payload.from).toBe("Squid by Ivora <hello@squidcharge.io>");
    expect(payload.to).toEqual(["host@example.com"]);
    expect(payload.text).toContain(
      `https://squid.example/login/confirm#token_hash=${token}`,
    );
    expect(options.headers["Idempotency-Key"]).toMatch(
      /^squid-sign-in\/[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      "host@example.com",
    );
  });
  it("rejects cross-origin requests before generating or sending a link", async () => {
    const response = await login(
      request(
        "/auth/login",
        { email: "host@example.com" },
        "https://evil.example",
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid recipients before contacting providers", async () => {
    expect(
      (await login(request("/auth/login", { email: "not-an-email" }))).status,
    ).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("enforces database quotas before any provider write", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(
      (await login(request("/auth/login", { email: "host@example.com" })))
        .status,
    ).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("fails closed if distributed throttling is unavailable", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "not-installed" },
    });
    expect(
      (await login(request("/auth/login", { email: "host@example.com" })))
        .status,
    ).toBe(503);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not claim success or fall back to duplicate delivery on Resend rejection", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("sensitive provider response", { status: 403 }),
    );
    const response = await login(
      request("/auth/login", { email: "host@example.com" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
    expect(mocks.otp).not.toHaveBeenCalled();
  });
  it("preserves Supabase delivery for forks without a Resend key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(
      (await login(request("/auth/login", { email: "host@example.com" })))
        .status,
    ).toBe(200);
    expect(mocks.otp).toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("escapes links in email HTML", () => {
    expect(
      signInEmail('https://squid.example/?x="<script>').html,
    ).not.toContain("<script>");
  });
});
describe("scanner-safe email confirmation", () => {
  it("does not consume a token when a scanner opens an existing email URL", async () => {
    const response = await openLink(
      new NextRequest(`https://squid.example/auth/confirm?token_hash=${token}`),
    );
    expect(response.headers.get("location")).toBe(
      `https://squid.example/login/confirm#token_hash=${token}`,
    );
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("verifies the token on an explicit same-origin POST", async () => {
    const response = await confirm(
      request("/auth/confirm", { token_hash: token }),
    );
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      token_hash: token,
      type: "email",
    });
    expect(await response.json()).toEqual({ ok: true });
  });
  it("rejects cross-origin confirmation and expired tokens", async () => {
    expect(
      (
        await confirm(
          request(
            "/auth/confirm",
            { token_hash: token },
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValueOnce({ error: { message: "expired" } });
    expect(
      (await confirm(request("/auth/confirm", { token_hash: token }))).status,
    ).toBe(401);
  });
});
