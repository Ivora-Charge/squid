import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { appUrl, authCookieOptions } from "@/lib/server/config";
import { sameOrigin } from "@/lib/server/security";
import { signInLink } from "@/lib/server/email";

vi.mock("@/lib/server/db", () => ({ user: async () => null }));

function from(host: string, forwarded?: string) {
  return {
    headers: new Headers({
      host,
      ...(forwarded ? { "x-forwarded-host": forwarded } : {}),
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("PREVIEW_HOST_SUFFIX", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("preview-aware app origin", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.squid.example");
    vi.stubEnv("VERCEL_URL", "squid-abc123.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "squid-git-feature.vercel.app");
    vi.stubEnv("PREVIEW_HOST_SUFFIX", ".preview.example");
  });

  it("uses an allow-listed preview host", () => {
    expect(appUrl(from("pr-12.preview.example"))).toBe(
      "https://pr-12.preview.example",
    );
    expect(appUrl(from("PR-12.Preview.Example"))).toBe(
      "https://pr-12.preview.example",
    );
    expect(appUrl(from("squid-abc123.vercel.app"))).toBe(
      "https://squid-abc123.vercel.app",
    );
    expect(appUrl(from("squid-git-feature.vercel.app"))).toBe(
      "https://squid-git-feature.vercel.app",
    );
    expect(
      appUrl(from("squid-abc123.vercel.app", "pr-12.preview.example")),
    ).toBe("https://pr-12.preview.example");
  });

  it("accepts a suffix configured without its leading dot", () => {
    vi.stubEnv("PREVIEW_HOST_SUFFIX", "preview.example");
    expect(appUrl(from("pr-12.preview.example"))).toBe(
      "https://pr-12.preview.example",
    );
    expect(appUrl(from("evilpreview.example"))).toBe(
      "https://www.squid.example",
    );
  });

  it("rejects spoofed or malformed hosts", () => {
    for (const host of [
      "evil.example",
      "preview.example",
      "evilpreview.example",
      "pr-12.preview.example.evil.example",
      "pr-12.preview.example:8443",
      "user@pr-12.preview.example",
      "evil.example/.preview.example",
      "evil.example, pr-12.preview.example",
      "other-abc123.vercel.app",
      "",
    ])
      expect(appUrl(from(host))).toBe("https://www.squid.example");
    // A forged forwarded host is not rescued by an allowed Host header.
    expect(appUrl(from("pr-12.preview.example", "evil.example"))).toBe(
      "https://www.squid.example",
    );
  });

  it("ignores the suffix when none is configured", () => {
    vi.stubEnv("PREVIEW_HOST_SUFFIX", "");
    expect(appUrl(from("pr-12.preview.example"))).toBe(
      "https://www.squid.example",
    );
    vi.stubEnv("PREVIEW_HOST_SUFFIX", ".");
    expect(appUrl(from("pr-12.preview.example"))).toBe(
      "https://www.squid.example",
    );
  });

  it("checks form origins, cookies and email links against the preview", () => {
    const request = (origin: string) =>
      new NextRequest("https://pr-12.preview.example/api/checkout", {
        headers: { host: "pr-12.preview.example", origin },
      });
    expect(() =>
      sameOrigin(request("https://pr-12.preview.example")),
    ).not.toThrow();
    expect(() => sameOrigin(request("https://www.squid.example"))).toThrow();
    expect(authCookieOptions(from("pr-12.preview.example")).secure).toBe(true);
    expect(
      signInLink(
        "a".repeat(40),
        "signin",
        appUrl(from("pr-12.preview.example")),
      ),
    ).toMatch(/^https:\/\/pr-12\.preview\.example\/login\/confirm#/);
  });

  it("keeps the configured origin when there is no request", () => {
    expect(appUrl()).toBe("https://www.squid.example");
  });
});

describe("production and local origins are unchanged", () => {
  it("ignores request hosts in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.squid.example");
    vi.stubEnv("VERCEL_URL", "squid-abc123.vercel.app");
    vi.stubEnv("PREVIEW_HOST_SUFFIX", ".preview.example");
    for (const host of [
      "pr-12.preview.example",
      "squid-abc123.vercel.app",
      "evil.example",
    ])
      expect(appUrl(from(host))).toBe("https://www.squid.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.squid.example/");
    expect(appUrl(from("pr-12.preview.example"))).toBe(
      "https://app.squid.example",
    );
  });

  it("ignores request hosts locally", () => {
    vi.stubEnv("PREVIEW_HOST_SUFFIX", ".preview.example");
    expect(appUrl(from("pr-12.preview.example"))).toBe("http://localhost:3000");
    expect(authCookieOptions(from("pr-12.preview.example")).secure).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.168.1.50:3000");
    expect(appUrl(from("evil.example"))).toBe("http://192.168.1.50:3000");
  });
});
