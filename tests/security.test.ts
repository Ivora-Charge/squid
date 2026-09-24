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
import {
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
