import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

type Query = { table: string; calls: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  result: vi.fn(),
  fetch: vi.fn(),
  authorize: vi.fn(),
  queries: [] as Query[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));
vi.mock("@/lib/server/db", () => {
  class LockBusyError extends Error {}
  // A chainable stand-in for the Supabase query builder. Each query is
  // recorded and resolved through mocks.result(table, calls).
  function from(table: string) {
    const query: Query = { table, calls: [] };
    mocks.queries.push(query);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then")
            return (resolve: (v: unknown) => void, reject: () => void) =>
              Promise.resolve(mocks.result(table, query.calls)).then(
                resolve,
                reject,
              );
          if (prop === "maybeSingle" || prop === "single")
            return async () => mocks.result(table, query.calls);
          return (...args: unknown[]) => {
            query.calls.push([prop, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  }
  return {
    user: mocks.user,
    db: () => ({ from, rpc: mocks.rpc }),
    checked: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw new Error("Database unavailable");
      return result.data;
    },
    withLock: (_key: string, run: () => Promise<unknown>) => run(),
    LockBusyError,
  };
});
vi.mock("@/lib/server/admin", async (original) => ({
  ...(await original<typeof import("@/lib/server/admin")>()),
  authorizeWorkspace: mocks.authorize,
}));
import {
  issueBlocks,
  oneClickUrl,
  renderIssue,
  trackedLink,
  unsubscribeToken,
  verifyClick,
  verifyUnsubscribeToken,
  continueSending,
  contentHash,
} from "@/lib/server/newsletter";
import { NEWSLETTER_CONSENT } from "@/lib/newsletter";
import { POST as consent } from "@/app/api/host/newsletter/route";
import { POST as issueAction } from "@/app/api/admin/newsletter/[id]/route";
import { GET as overview } from "@/app/api/admin/newsletter/route";
import { POST as oneClick } from "@/app/api/newsletter/unsubscribe/route";
import { GET as click } from "@/app/api/newsletter/click/route";
import { POST as webhook } from "@/app/api/newsletter/webhook/route";
import { GET as cron } from "@/app/api/cron/newsletter/route";

const admin = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "mingcan@ivoracharge.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
} as User;
const host = {
  ...admin,
  id: "10000000-0000-4000-8000-000000000002",
  email: "host@example.com",
} as User;
const issueId = "20000000-0000-4000-8000-000000000001";
const deliveryId = "30000000-0000-4000-8000-000000000001";
const issue = {
  id: issueId,
  title: "Spring tips",
  body: "Hello <hosts>.\n\nRead the [guide](https://www.squidcharge.io/developers).",
  status: "draft",
  approved_hash: null,
  updated_at: "2026-10-16T00:00:00.000000+00:00",
};
const webhookSecret = `whsec_${Buffer.from("test-webhook-key").toString("base64")}`;
function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`https://squid.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://squid.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function resendCalls() {
  return mocks.fetch.mock.calls.filter(
    ([url]) => url === "https://api.resend.com/emails",
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.queries.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squid.example");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("RESEND_API_KEY", "re_test_private");
  vi.stubEnv("RESEND_FROM_EMAIL", "Squid by Ivora <hello@squidcharge.io>");
  vi.stubEnv("NEWSLETTER_SIGNING_KEY", "k".repeat(40));
  vi.stubEnv("NEWSLETTER_POSTAL_ADDRESS", "1 Example Way, Testville, CA 90000");
  vi.stubEnv("NEWSLETTER_SENDING_ENABLED", "");
  vi.stubEnv("CRON_SECRET", "cron-test");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.user.mockResolvedValue(admin);
  mocks.authorize.mockImplementation(async (actor: User) => ({
    host: actor,
    actingAs: null,
  }));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.result.mockImplementation((table: string) =>
    table === "squid_newsletter_issues"
      ? { data: issue, error: null }
      : { data: null, error: null },
  );
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("newsletter content", () => {
  it("escapes content, allows only Squid links, and always carries the footer", () => {
    const { html, text, subject } = renderIssue(issue, {
      unsubscribeUrl: "https://squid.example/newsletter/unsubscribe?t=x",
      postalAddress: "1 Example Way",
    });
    expect(subject).toBe("Spring tips · Squid by Ivora");
    expect(html).toContain("Hello &lt;hosts&gt;.");
    expect(html).not.toContain("<hosts>");
    expect(html).toContain('href="https://www.squidcharge.io/developers"');
    expect(html).toContain("1 Example Way");
    expect(html).toContain(
      'href="https://squid.example/newsletter/unsubscribe?t=x"',
    );
    expect(text).toContain("Unsubscribe: https://squid.example/newsletter");
    expect(() => issueBlocks("[Win](https://evil.example/)")).toThrow(
      /squidcharge\.io/,
    );
    expect(() => issueBlocks("[Win](javascript:alert(1))")).toThrow();
    expect(() => issueBlocks("Visit https://evil.example today")).toThrow(
      /\[label\]/,
    );
    expect(() => issueBlocks("[Docs](http://www.squidcharge.io/)")).toThrow();
  });
  it("signs unsubscribe tokens and click links", () => {
    const token = unsubscribeToken(deliveryId);
    expect(verifyUnsubscribeToken(token)).toBe(deliveryId);
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
    expect(
      verifyUnsubscribeToken(
        token.replace(deliveryId, "30000000-0000-4000-8000-000000000002"),
      ),
    ).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    const href = "https://www.squidcharge.io/developers";
    const url = new URL(trackedLink(deliveryId, href));
    const s = url.searchParams.get("s")!;
    expect(verifyClick(deliveryId, href, s)).toBe(true);
    expect(verifyClick(deliveryId, "https://www.squidcharge.io/", s)).toBe(
      false,
    );
    expect(verifyClick(deliveryId, "https://evil.example/", s)).toBe(false);
  });
});

describe("host newsletter consent", () => {
  it("records the host's own opt-in with the displayed wording", async () => {
    mocks.user.mockResolvedValue(host);
    mocks.rpc.mockResolvedValue({
      data: { subscribed: true, updated_at: "2026-10-16T12:00:00Z" },
      error: null,
    });
    const response = await consent(
      post("/api/host/newsletter", { subscribed: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      subscribed: true,
      updatedAt: "2026-10-16T12:00:00Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("squid_newsletter_set_consent", {
      target_host: host.id,
      now_subscribed: true,
      consent_wording: NEWSLETTER_CONSENT,
    });
  });
  it("rejects cross-site, signed-out, malformed and tenant-access changes", async () => {
    mocks.user.mockResolvedValue(host);
    expect(
      (
        await consent(
          post(
            "/api/host/newsletter",
            { subscribed: true },
            { origin: "https://evil.example" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await consent(post("/api/host/newsletter", { subscribed: "yes" })))
        .status,
    ).toBe(400);
    mocks.user.mockResolvedValue(null);
    expect(
      (await consent(post("/api/host/newsletter", { subscribed: true })))
        .status,
    ).toBe(401);
    mocks.user.mockResolvedValue(admin);
    mocks.authorize.mockResolvedValue({
      host,
      actingAs: { id: "lease", email: host.email, expiresAt: "" },
    });
    expect(
      (await consent(post("/api/host/newsletter", { subscribed: true })))
        .status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("one-click unsubscribe", () => {
  it("accepts an RFC 8058 POST with only the signed token", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const request = new NextRequest(
      `https://squid.example/api/newsletter/unsubscribe?t=${unsubscribeToken(deliveryId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
    );
    const response = await oneClick(request);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("squid_newsletter_unsubscribe", {
      target_delivery: deliveryId,
    });
    expect(new URL(oneClickUrl(deliveryId)).pathname).toBe(
      "/api/newsletter/unsubscribe",
    );
  });
  it("redirects the confirmation page and refuses forged tokens", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const page = await oneClick(
      post(
        `/api/newsletter/unsubscribe?t=${unsubscribeToken(deliveryId)}`,
        "List-Unsubscribe=One-Click",
        {
          accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      ),
    );
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe(
      "https://squid.example/newsletter/unsubscribe?done=1",
    );
    mocks.rpc.mockClear();
    const forged = await oneClick(
      post(`/api/newsletter/unsubscribe?t=${deliveryId}.forged`, ""),
    );
    expect(forged.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("click tracking", () => {
  it("redirects only signed Squid links and counts the click", async () => {
    mocks.result.mockImplementation((table: string) =>
      table === "squid_newsletter_deliveries"
        ? { data: { issue_id: issueId }, error: null }
        : { data: null, error: null },
    );
    const href = "https://www.squidcharge.io/developers";
    const response = await click(
      new NextRequest(trackedLink(deliveryId, href)),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(href);
    const insert = mocks.queries.find(
      (q) => q.table === "squid_newsletter_clicks",
    );
    expect(insert?.calls[0]).toEqual([
      "insert",
      [{ issue_id: issueId, delivery_id: deliveryId, url: href }],
    ]);
    const forged = new URL(trackedLink(deliveryId, href));
    forged.searchParams.set("u", "https://evil.example/");
    expect((await click(new NextRequest(forged))).status).toBe(400);
  });
});

describe("admin approval gate", () => {
  it("is admin-only", async () => {
    mocks.user.mockResolvedValue(host);
    expect((await overview()).status).toBe(403);
    expect(
      (
        await issueAction(
          post(`/api/admin/newsletter/${issueId}`, { action: "send" }),
          params(issueId),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends nothing, not even a test, while sending is disabled", async () => {
    for (const action of ["test", "send"]) {
      const response = await issueAction(
        post(`/api/admin/newsletter/${issueId}`, { action }),
        params(issueId),
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/disabled/);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    const scheduled = await cron(
      new NextRequest("https://squid.example/api/cron/newsletter", {
        headers: { authorization: "Bearer cron-test" },
      }),
    );
    expect(await scheduled.json()).toEqual({ skipped: true });
    expect(mocks.queries).toHaveLength(0);
  });
  it("refuses to send an issue the database has not approved", async () => {
    vi.stubEnv("NEWSLETTER_SENDING_ENABLED", "true");
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "Only an approved issue can be sent" },
    });
    const response = await issueAction(
      post(`/api/admin/newsletter/${issueId}`, { action: "send" }),
      params(issueId),
    );
    expect(response.status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("sends a test only to the administrator and records the tested content", async () => {
    vi.stubEnv("NEWSLETTER_SENDING_ENABLED", "true");
    mocks.result.mockImplementation((table: string, calls: Query["calls"]) =>
      table === "squid_newsletter_issues"
        ? {
            data: calls.some(([op]) => op === "update")
              ? { id: issueId }
              : issue,
            error: null,
          }
        : { data: null, error: null },
    );
    const response = await issueAction(
      post(`/api/admin/newsletter/${issueId}`, { action: "test" }),
      params(issueId),
    );
    expect(response.status).toBe(200);
    const [[, options]] = resendCalls();
    const payload = JSON.parse(options.body);
    expect(payload.to).toEqual([admin.email]);
    expect(payload.subject).toMatch(/^\[Test\]/);
    const update = mocks.queries.find((q) =>
      q.calls.some(([op]) => op === "update"),
    );
    expect(update?.calls[0][1][0]).toMatchObject({
      tested_hash: contentHash(issue.title, issue.body),
    });
  });
  it("passes the previewed hash to the database approval", async () => {
    const hash = contentHash(issue.title, issue.body);
    const response = await issueAction(
      post(`/api/admin/newsletter/${issueId}`, { action: "approve", hash }),
      params(issueId),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("squid_newsletter_approve", {
      admin_id: admin.id,
      target_id: issueId,
      content_hash: hash,
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "Send a test of this exact draft" },
    });
    expect(
      (
        await issueAction(
          post(`/api/admin/newsletter/${issueId}`, { action: "approve", hash }),
          params(issueId),
        )
      ).status,
    ).toBe(409);
  });
  it("sends approved issues with one-click unsubscribe headers, footer and signed links", async () => {
    vi.stubEnv("NEWSLETTER_SENDING_ENABLED", "true");
    const approved = {
      ...issue,
      status: "sending",
      approved_hash: contentHash(issue.title, issue.body),
    };
    let pending = [
      { id: deliveryId, issue_id: issueId, email: "host@example.com" },
    ];
    mocks.result.mockImplementation((table: string) =>
      table === "squid_newsletter_issues"
        ? { data: approved, error: null }
        : { data: null, error: null },
    );
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "squid_newsletter_start_send")
        return { data: 1, error: null };
      if (name === "squid_newsletter_pending") {
        const batch = pending;
        pending = [];
        return { data: batch, error: null };
      }
      return { data: null, error: null };
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pendingResponse = issueAction(
        post(`/api/admin/newsletter/${issueId}`, { action: "send" }),
        params(issueId),
      );
      await vi.runAllTimersAsync();
      const response = await pendingResponse;
      expect(await response.json()).toEqual({
        recipients: 1,
        sent: 1,
        done: true,
      });
    } finally {
      vi.useRealTimers();
    }
    const [[, options]] = resendCalls();
    const payload = JSON.parse(options.body);
    const oneClickHeader = payload.headers["List-Unsubscribe"];
    expect(oneClickHeader).toBe(`<${oneClickUrl(deliveryId)}>`);
    expect(payload.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(options.headers["Idempotency-Key"]).toBe(
      `squid-newsletter/${deliveryId}`,
    );
    expect(payload.to).toEqual(["host@example.com"]);
    expect(payload.html).toContain("1 Example Way, Testville, CA 90000");
    expect(payload.html).toContain(
      "https://squid.example/newsletter/unsubscribe?t=",
    );
    expect(payload.html).toContain(
      "https://squid.example/api/newsletter/click?",
    );
    expect(payload.html).not.toContain(
      'href="https://www.squidcharge.io/developers"',
    );
    // No open-tracking pixel.
    expect(payload.html).not.toMatch(/<img/i);
    const sent = mocks.queries.find(
      (q) => q.table === "squid_newsletter_deliveries",
    );
    expect(sent?.calls[0][1][0]).toMatchObject({
      status: "sent",
      provider_id: "email_1",
    });
  });
});

describe("bounce and complaint webhooks", () => {
  function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac(
      "sha256",
      Buffer.from(webhookSecret.slice(6), "base64"),
    )
      .update(`msg_1.${timestamp}.${body}`)
      .digest("base64");
    return post("/api/newsletter/webhook", body, {
      "svix-id": "msg_1",
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    });
  }
  it("adds verified bounces to the suppression list", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", webhookSecret);
    const body = JSON.stringify({
      type: "email.bounced",
      data: {
        email_id: "email_1",
        to: ["host@example.com"],
        bounce: { type: "Permanent" },
      },
    });
    expect((await webhook(signed(body))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("squid_newsletter_bounce", {
      provider: "email_1",
      addresses: ["host@example.com"],
      kind: "bounced",
    });
  });
  it("rejects unsigned, stale or unconfigured deliveries and ignores temporary bounces", async () => {
    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "email_1", to: ["host@example.com"] },
    });
    expect((await webhook(signed(body))).status).toBe(503);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", webhookSecret);
    expect((await webhook(post("/api/newsletter/webhook", body))).status).toBe(
      400,
    );
    expect(
      (await webhook(signed(body, Math.floor(Date.now() / 1000) - 3600)))
        .status,
    ).toBe(400);
    const temporary = JSON.stringify({
      type: "email.bounced",
      data: { to: ["host@example.com"], bounce: { type: "Transient" } },
    });
    expect((await webhook(signed(temporary))).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("scheduled sending", () => {
  it("requires the cron secret", async () => {
    const response = await cron(
      new NextRequest("https://squid.example/api/cron/newsletter"),
    );
    expect(response.status).toBe(401);
    expect(await continueSending()).toEqual({ skipped: true });
  });
});
