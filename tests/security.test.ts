import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
  }),
}));
vi.mock("@/lib/server/db", () => ({ user: async () => null }));
import { IvoraError } from "@/lib/server/ivora";
import {
  failure,
  guestToken,
  issueGuestCookie,
  requireGuest,
  requireHost,
  sameOrigin,
} from "@/lib/server/security";
describe("application authorization", () => {
  beforeEach(() => {
    jar.clear();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-signing-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  });
  it("rejects a logged-out host", async () => {
    await expect(requireHost()).rejects.toMatchObject({ status: 401 });
  });
  it("requires a private guest cookie, not knowledge of a session URL", async () => {
    await expect(requireGuest("session-one")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("scopes each guest cookie to exactly one session", async () => {
    await issueGuestCookie("session-one");
    await expect(requireGuest("session-one")).resolves.toBeUndefined();
    jar.set("squid_guest_session-two", guestToken("session-one"));
    await expect(requireGuest("session-two")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects forged guest capabilities", async () => {
    jar.set("squid_guest_session-one", "a".repeat(64));
    await expect(requireGuest("session-one")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects cross-origin mutations and missing Origin headers", () => {
    for (const origin of ["https://evil.example", "null", ""])
      expect(() =>
        sameOrigin(
          new NextRequest("https://squid.example/api/checkout", {
            headers: origin ? { origin } : {},
          }),
        ),
      ).toThrow();
  });
  it("accepts the canonical origin only", () => {
    expect(() =>
      sameOrigin(
        new NextRequest("https://squid.example/api/checkout", {
          headers: { origin: "https://squid.example" },
        }),
      ),
    ).not.toThrow();
  });
});
describe("Ivora failures shown to hosts", () => {
  it("asks the host to disconnect when a password change needs stations:admin", async () => {
    const response = failure(
      new IvoraError(403, "stations_admin_required", "Needs stations:admin"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Disconnect your charger before preparing its connection password.",
    });
  });
  it("maps any Ivora 429 to the friendly rate limit with its Retry-After", async () => {
    const limited = failure(
      new IvoraError(429, "credential_rate_limited", "x", null, null, 600),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("600");
    expect(await limited.json()).toEqual({
      error: "Too many charger requests right now. Try again in 10 minutes.",
    });
    const brief = failure(new IvoraError(429, "anything", "x", null, null, 30));
    expect((await brief.json()).error).toMatch(/Try again in 1 minute\.$/);
    const bare = failure(new IvoraError(429, "rate_limited", "x"));
    expect(bare.status).toBe(429);
    expect((await bare.json()).error).toMatch(/Try again in a minute\.$/);
  });
});
