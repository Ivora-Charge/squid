import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  password: vi.fn(),
  signup: vi.fn(),
  generate: vi.fn(),
  recovery: vi.fn(),
  verify: vi.fn(),
  getUser: vi.fn(),
  update: vi.fn(),
  oauth: vi.fn(),
  exchange: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    rpc: mocks.rpc,
    auth: { admin: { generateLink: mocks.generate } },
  }),
  auth: async () => ({
    auth: {
      signInWithPassword: mocks.password,
      signUp: mocks.signup,
      resetPasswordForEmail: mocks.recovery,
      verifyOtp: mocks.verify,
      getUser: mocks.getUser,
      updateUser: mocks.update,
      signInWithOAuth: mocks.oauth,
      exchangeCodeForSession: mocks.exchange,
    },
  }),
  user: async () => null,
}));
import {
  POST as signIn,
  PATCH as changePassword,
} from "@/app/auth/password/route";
import { POST as signup } from "@/app/auth/signup/route";
import { POST as recover } from "@/app/auth/recover/route";
import { POST as confirmRecovery } from "@/app/auth/recover/confirm/route";
import { POST as google } from "@/app/auth/google/route";
import { GET as callback } from "@/app/auth/callback/route";
const token = "b".repeat(64);
const password = "An example password 47!";
function request(
  path: string,
  body: unknown,
  method = "POST",
  origin = "https://squid.example",
) {
  return new NextRequest(`https://squid.example${path}`, {
    method,
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private");
  vi.stubEnv("RESEND_API_KEY", "re_test_private");
  vi.stubEnv("RESEND_FROM_EMAIL", "Squid by Ivora <hello@squidcharge.io>");
  vi.stubEnv("VERCEL", "1");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.password.mockResolvedValue({
    data: {
      session: { access_token: "private-token" },
      user: { id: "host-id" },
    },
    error: null,
  });
  mocks.generate.mockResolvedValue({
    data: { properties: { hashed_token: token } },
    error: null,
  });
  mocks.signup.mockResolvedValue({ data: { session: null }, error: null });
  mocks.recovery.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "verified-host" } },
    error: null,
  });
  mocks.update.mockResolvedValue({ error: null });
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.oauth.mockResolvedValue({
    data: {
      url: "https://project.supabase.co/auth/v1/authorize?provider=google&code_challenge=test",
    },
    error: null,
  });
  mocks.fetch.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/settings")
            ? { external: { google: true } }
            : { id: "email-test" },
        ),
        { status: 200 },
      ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("password authentication", () => {
  it("uses the password exactly as entered and returns no session secrets", async () => {
    const response = await signIn(
      request("/auth/password", {
        email: " Host@Example.com ",
        password: ` ${password} `,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.password).toHaveBeenCalledWith({
      email: "host@example.com",
      password: ` ${password} `,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(
      /host@example\.com|An example/,
    );
  });
  it("rejects invalid inputs and cross-origin login before contacting Supabase", async () => {
    expect(
      (await signIn(request("/auth/password", { email: "invalid", password })))
        .status,
    ).toBe(400);
    expect(
      (
        await signIn(
          request(
            "/auth/password",
            { email: "host@example.com", password },
            "POST",
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.password).not.toHaveBeenCalled();
  });
  it("rate limits password attempts without sending mail", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(
      (
        await signIn(
          request("/auth/password", { email: "host@example.com", password }),
        )
      ).status,
    ).toBe(429);
    expect(mocks.password).not.toHaveBeenCalled();
  });
  it("reports incorrect credentials without exposing provider data", async () => {
    mocks.password.mockResolvedValue({
      data: {},
      error: { code: "invalid_credentials", message: "private detail" },
    });
    const response = await signIn(
      request("/auth/password", { email: "host@example.com", password }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Email or password is incorrect.",
    });
  });
  it("requires a real session and verified email", async () => {
    mocks.password.mockResolvedValueOnce({
      data: { session: null, user: {} },
      error: null,
    });
    expect(
      (
        await signIn(
          request("/auth/password", { email: "host@example.com", password }),
        )
      ).status,
    ).toBe(401);
    mocks.password.mockResolvedValueOnce({
      data: {},
      error: { code: "email_not_confirmed" },
    });
    expect(
      await (
        await signIn(
          request("/auth/password", { email: "host@example.com", password }),
        )
      ).text(),
    ).toContain("Confirm your email");
  });
});
describe("password signup and recovery emails", () => {
  it("sends signup confirmation through Resend without returning or emailing a password", async () => {
    const response = await signup(
      request("/auth/signup", { email: "Host@Example.com", password }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      confirmationRequired: true,
    });
    expect(mocks.generate).toHaveBeenCalledWith({
      type: "signup",
      email: "host@example.com",
      password,
      options: { redirectTo: "https://squid.example/login/confirm" },
    });
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(payload.subject).toContain("Confirm your email");
    expect(payload.text).toContain(`/login/confirm#token_hash=${token}`);
    expect(JSON.stringify(payload)).not.toContain(password);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not change or disclose an existing account on duplicate signup", async () => {
    mocks.generate.mockResolvedValue({
      data: {},
      error: { code: "email_exists" },
    });
    const response = await signup(
      request("/auth/signup", { email: "host@example.com", password }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      confirmationRequired: true,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects weak or overlong passwords before creating a user", async () => {
    for (const value of ["short", "é".repeat(40)]) {
      expect(
        (
          await signup(
            request("/auth/signup", {
              email: "host@example.com",
              password: value,
            }),
          )
        ).status,
      ).toBe(400);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("hides whether a recovery account exists and never creates it", async () => {
    mocks.generate.mockResolvedValue({
      data: {},
      error: { code: "user_not_found" },
    });
    expect(
      await (
        await recover(request("/auth/recover", { email: "host@example.com" }))
      ).json(),
    ).toEqual({ ok: true });
    expect(mocks.generate.mock.calls[0][0].type).toBe("recovery");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it("delivers a recovery token only through the reset email", async () => {
    const response = await recover(
      request("/auth/recover", { email: "host@example.com" }),
    );
    expect(await response.json()).toEqual({ ok: true });
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(payload.subject).toContain("Reset your Squid password");
    expect(payload.text).toContain(`/login/reset#token_hash=${token}`);
    expect(payload.text).not.toContain("/login/confirm");
  });
  it("reports a delivery failure instead of claiming a confirmation was sent", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("private provider failure", { status: 403 }),
    );
    const response = await signup(
      request("/auth/signup", { email: "host@example.com", password }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider");
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it("supports Supabase email delivery when a fork has no Resend key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(
      (
        await signup(
          request("/auth/signup", { email: "host@example.com", password }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await recover(request("/auth/recover", { email: "host@example.com" })))
        .status,
    ).toBe(200);
    expect(mocks.signup).toHaveBeenCalled();
    expect(mocks.recovery).toHaveBeenCalledWith("host@example.com", {
      redirectTo: "https://squid.example/auth/callback?next=/login/reset",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
describe("password changes", () => {
  it("rejects password changes when running the demo without auth credentials", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect(
      (await changePassword(request("/auth/password", { password }, "PATCH")))
        .status,
    ).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("verifies a recovery token with the recovery purpose", async () => {
    expect(
      (
        await confirmRecovery(
          request("/auth/recover/confirm", { token_hash: token }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      token_hash: token,
      type: "recovery",
    });
  });
  it("rejects expired recovery tokens and cross-origin consumption", async () => {
    expect(
      (
        await confirmRecovery(
          request(
            "/auth/recover/confirm",
            { token_hash: token },
            "POST",
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValue({ error: { code: "otp_expired" } });
    expect(
      (
        await confirmRecovery(
          request("/auth/recover/confirm", { token_hash: token }),
        )
      ).status,
    ).toBe(401);
  });
  it("requires a verified session before updating a password", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: {} });
    expect(
      (
        await changePassword(
          request("/auth/password", { password, user_id: "forged" }, "PATCH"),
        )
      ).status,
    ).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates only the authenticated user and rejects cross-origin requests", async () => {
    expect(
      (
        await changePassword(
          request(
            "/auth/password",
            { password },
            "PATCH",
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      (
        await changePassword(
          request(
            "/auth/password",
            { password, email: "victim@example.com" },
            "PATCH",
          ),
        )
      ).status,
    ).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ password });
  });
});
describe("Google OAuth and callbacks", () => {
  it("initiates Google with a canonical callback and the SSR client's PKCE flow", async () => {
    const response = await google(
      request("/auth/google", { redirectTo: "https://evil.example" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.oauth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://squid.example/auth/callback",
        queryParams: { prompt: "select_account" },
        skipBrowserRedirect: true,
      },
    });
    expect(await response.json()).toEqual({
      url: expect.stringContaining("code_challenge="),
    });
  });
  it("keeps a disabled provider's error inside Squid", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ external: { google: false } })),
    );
    const response = await google(request("/auth/google", {}));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not available yet");
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it("rejects cross-origin OAuth initiation", async () => {
    expect(
      (
        await google(
          request("/auth/google", {}, "POST", "https://evil.example"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it("ignores external callback destinations and exchanges only the authorization code", async () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
    ]) {
      const response = await callback(
        new NextRequest(
          `https://squid.example/auth/callback?code=one-use-code&next=${encodeURIComponent(next)}`,
        ),
      );
      expect(response.headers.get("location")).toBe(
        "https://squid.example/dashboard",
      );
    }
    expect(mocks.exchange).toHaveBeenCalledWith("one-use-code");
  });
  it("supports the fixed password reset callback and handles OAuth cancellation", async () => {
    const response = await callback(
      new NextRequest(
        "https://squid.example/auth/callback?code=one-use-code&next=/login/reset",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://squid.example/login/reset",
    );
    mocks.exchange.mockClear();
    const canceled = await callback(
      new NextRequest(
        "https://squid.example/auth/callback?error=access_denied&error_description=private",
      ),
    );
    expect(canceled.headers.get("location")).toBe(
      "https://squid.example/login?error=auth",
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
