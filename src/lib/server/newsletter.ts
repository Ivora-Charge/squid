import "server-only";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  NewsletterIssue,
  NewsletterOverview,
  NewsletterPreview,
} from "../admin-types";
import { NEWSLETTER_CONSENT, type NewsletterConsent } from "../newsletter";
import { isAdmin } from "./admin";
import { appUrl, required } from "./config";
import { checked, db, LockBusyError, withLock } from "./db";
import { escapeHtml } from "./email";
import { HttpError } from "./http-error";

const LINK_HOSTS = new Set(["squidcharge.io", "www.squidcharge.io"]);
// Resend's default limit is two requests per second.
const SEND_INTERVAL_MS = 550;

export function newsletterConfig() {
  const missing = [
    "RESEND_API_KEY",
    "NEWSLETTER_POSTAL_ADDRESS",
    "NEWSLETTER_SIGNING_KEY",
  ].filter((name) => !process.env[name]);
  if (!process.env.NEWSLETTER_FROM_EMAIL && !process.env.RESEND_FROM_EMAIL)
    missing.push("NEWSLETTER_FROM_EMAIL");
  return {
    enabled: process.env.NEWSLETTER_SENDING_ENABLED === "true",
    missing,
  };
}
function assertSendingAllowed() {
  const config = newsletterConfig();
  if (!config.enabled)
    throw new HttpError(
      409,
      "Newsletter sending is disabled. Set NEWSLETTER_SENDING_ENABLED=true once DKIM and DMARC are in place.",
    );
  if (config.missing.length)
    throw new HttpError(
      409,
      `Newsletter sending needs ${config.missing.join(", ")}.`,
    );
}

export function contentHash(title: string, body: string) {
  return createHash("sha256").update(`${title}\n${body}`, "utf8").digest("hex");
}
export function allowedLink(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const ok =
    (url.protocol === "https:" && LINK_HOSTS.has(url.hostname)) ||
    url.origin === new URL(appUrl()).origin;
  return ok ? url.toString() : null;
}
type Segment = { text: string; href?: string };
// Issue bodies are plain text. Blank lines separate paragraphs and
// [label](https://www.squidcharge.io/…) adds a link; nothing else is markup.
export function issueBlocks(body: string): Segment[][] {
  return body
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => {
      const segments: Segment[] = [];
      let last = 0;
      for (const match of paragraph.matchAll(
        /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g,
      )) {
        if (match.index > last)
          segments.push({ text: paragraph.slice(last, match.index) });
        const href = allowedLink(match[2]);
        if (!href)
          throw new HttpError(
            400,
            "Newsletter links must point to https://www.squidcharge.io.",
          );
        segments.push({ text: match[1], href });
        last = match.index + match[0].length;
      }
      if (last < paragraph.length)
        segments.push({ text: paragraph.slice(last) });
      if (segments.some((s) => !s.href && /https?:\/\/|www\./i.test(s.text)))
        throw new HttpError(
          400,
          "Write links as [label](https://www.squidcharge.io/…).",
        );
      return segments;
    });
}
export function renderIssue(
  issue: { title: string; body: string },
  options: {
    unsubscribeUrl: string;
    postalAddress: string;
    link?: (href: string) => string;
    test?: boolean;
  },
) {
  const link = options.link ?? ((href: string) => href);
  const blocks = issueBlocks(issue.body);
  const subject = `${options.test ? "[Test] " : ""}${issue.title} · Squid by Ivora`;
  const reason =
    "You’re receiving this because you turned on the Squid host newsletter in Settings.";
  const text = [
    ...(options.test
      ? ["Test send: only you received this. Links are not tracked."]
      : []),
    issue.title,
    ...blocks.map((segments) =>
      segments
        .map((s) => (s.href ? `${s.text} (${link(s.href)})` : s.text))
        .join(""),
    ),
    `--\n${reason}\nUnsubscribe: ${options.unsubscribeUrl}\n${options.postalAddress}`,
  ].join("\n\n");
  const paragraphs = blocks
    .map(
      (segments) =>
        `<p style="font-size:16px;line-height:1.6;color:#b5beb3;margin:0 0 18px">${segments
          .map((s) => {
            const label = escapeHtml(s.text).replace(/\n/g, "<br>");
            return s.href
              ? `<a href="${escapeHtml(link(s.href))}" style="color:#fa9477">${label}</a>`
              : label;
          })
          .join("")}</p>`,
    )
    .join("");
  const banner = options.test
    ? `<p style="margin:0 0 24px;padding:10px 14px;border-radius:8px;background:#272c24;color:#bdc7b4;font-size:13px">Test send: only you received this. Links are not tracked.</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(issue.title)}</title></head><body style="margin:0;background:#111513;color:#eeefe8;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111513"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#191e1b;border:1px solid #2d342e;border-radius:18px"><tr><td style="padding:36px">${banner}<div style="font-size:34px;font-weight:bold;letter-spacing:-2px;color:#fa9477">squid</div><div style="margin:2px 0 32px;font-size:10px;letter-spacing:3px;color:#99a298">HOST NEWSLETTER</div><h1 style="font-size:27px;line-height:1.2;margin:0 0 20px;color:#eeefe8">${escapeHtml(issue.title)}</h1>${paragraphs}<p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #2d342e;color:#99a298;font-size:12px;line-height:1.6">${reason} <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#bdd9ae">Unsubscribe</a><br>${escapeHtml(options.postalAddress).replace(/\n/g, "<br>")}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

function signingKey() {
  const key = required("NEWSLETTER_SIGNING_KEY");
  if (key.length < 32)
    throw new Error(
      "Missing NEWSLETTER_SIGNING_KEY with at least 32 random characters.",
    );
  return key;
}
function sign(purpose: "unsubscribe" | "click", value: string) {
  return createHmac("sha256", signingKey())
    .update(`squid-newsletter-${purpose}:${value}`)
    .digest("base64url");
}
function same(actual: string, expected: string) {
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function unsubscribeToken(deliveryId: string) {
  return `${deliveryId}.${sign("unsubscribe", deliveryId)}`;
}
export function verifyUnsubscribeToken(token: string) {
  const [id, signature, extra] = token.split(".");
  if (extra !== undefined || !UUID.test(id ?? "") || !signature) return null;
  return same(signature, sign("unsubscribe", id)) ? id : null;
}
// RFC 8058 one-click target for the List-Unsubscribe header.
export function oneClickUrl(deliveryId: string) {
  const url = new URL("/api/newsletter/unsubscribe", appUrl());
  url.searchParams.set("t", unsubscribeToken(deliveryId));
  return url.toString();
}
// Footer link: a page with a single confirm button, so link scanners that
// prefetch email URLs cannot unsubscribe anyone.
export function unsubscribePageUrl(deliveryId?: string) {
  const url = new URL("/newsletter/unsubscribe", appUrl());
  if (deliveryId) url.searchParams.set("t", unsubscribeToken(deliveryId));
  return url.toString();
}
export function trackedLink(deliveryId: string, href: string) {
  const url = new URL("/api/newsletter/click", appUrl());
  url.searchParams.set("d", deliveryId);
  url.searchParams.set("u", href);
  url.searchParams.set("s", sign("click", `${deliveryId}\n${href}`));
  return url.toString();
}
export function verifyClick(
  deliveryId: string,
  href: string,
  signature: string,
) {
  if (!UUID.test(deliveryId) || allowedLink(href) !== href) return false;
  return same(signature, sign("click", `${deliveryId}\n${href}`));
}

type Delivery = { id: string; issue_id: string; email: string };
type SendResult = { id: string } | { retry: true } | { failed: true };
async function deliver(
  message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
    tags?: { name: string; value: string }[];
  },
  idempotencyKey: string,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from:
          process.env.NEWSLETTER_FROM_EMAIL || required("RESEND_FROM_EMAIL"),
        ...message,
        to: [message.to],
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Unknown outcome: retry later with the same idempotency key.
    return { retry: true };
  }
  if (response.ok) {
    const data = (await response.json().catch(() => ({}))) as { id?: unknown };
    return { id: typeof data.id === "string" ? data.id.slice(0, 200) : "" };
  }
  console.error("[Squid newsletter] Delivery request failed", {
    status: response.status,
  });
  return response.status === 409 ||
    response.status === 429 ||
    response.status >= 500
    ? { retry: true }
    : { failed: true };
}

function rpcResult<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}) {
  if (result.error?.code === "42501")
    throw new HttpError(403, "Administrator access required.");
  if (result.error?.code === "P0002")
    throw new HttpError(404, "Record not found.");
  if (result.error?.code === "23514")
    throw new HttpError(409, result.error.message);
  return checked(result);
}
function requireNewsletterAdmin(actor: User) {
  if (!isAdmin(actor))
    throw new HttpError(403, "Administrator access required.");
}

export async function newsletterConsent(
  hostId: string,
): Promise<NewsletterConsent | null> {
  const { data, error } = await db()
    .from("squid_newsletter_consent")
    .select("subscribed,updated_at")
    .eq("host_id", hostId)
    .maybeSingle();
  if (error) return null;
  return {
    subscribed: Boolean(data?.subscribed),
    updatedAt: (data?.updated_at as string | undefined) ?? null,
  };
}
export async function setNewsletterConsent(
  hostId: string,
  subscribed: boolean,
): Promise<NewsletterConsent> {
  const result = rpcResult(
    await db().rpc("squid_newsletter_set_consent", {
      target_host: hostId,
      now_subscribed: subscribed,
      consent_wording: NEWSLETTER_CONSENT,
    }),
  ) as { subscribed: boolean; updated_at: string };
  return { subscribed: result.subscribed, updatedAt: result.updated_at };
}
export async function unsubscribe(token: string) {
  const id = verifyUnsubscribeToken(token);
  if (!id) throw new HttpError(400, "This unsubscribe link is not valid.");
  const found = checked(
    await db().rpc("squid_newsletter_unsubscribe", { target_delivery: id }),
  );
  if (!found) throw new HttpError(404, "This unsubscribe link is not valid.");
}
export async function recordClick(deliveryId: string, href: string) {
  const { data } = await db()
    .from("squid_newsletter_deliveries")
    .select("issue_id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (data)
    await db().from("squid_newsletter_clicks").insert({
      issue_id: data.issue_id,
      delivery_id: deliveryId,
      url: href,
    });
}

export const issueInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(20000),
  })
  .strict();
type IssueRow = {
  id: string;
  title: string;
  body: string;
  status: NewsletterIssue["status"];
  approved_hash: string | null;
  updated_at: string;
};
async function loadIssue(id: string): Promise<IssueRow> {
  const issue = checked(
    await db()
      .from("squid_newsletter_issues")
      .select("id,title,body,status,approved_hash,updated_at")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!issue) throw new HttpError(404, "Newsletter issue not found.");
  return issue as IssueRow;
}
export async function newsletterOverview(): Promise<NewsletterOverview> {
  const overview = rpcResult(
    await db().rpc("squid_newsletter_overview"),
  ) as Omit<NewsletterOverview, "sending">;
  return { ...overview, sending: newsletterConfig() };
}
export async function createIssue(
  actor: User,
  input: z.infer<typeof issueInput>,
) {
  requireNewsletterAdmin(actor);
  issueBlocks(input.body);
  const row = checked(
    await db()
      .from("squid_newsletter_issues")
      .insert({ title: input.title, body: input.body, created_by: actor.id })
      .select("id")
      .single(),
  ) as { id: string };
  return row.id;
}
// Any edit returns the issue to draft and discards its test and approval.
export async function saveIssue(
  actor: User,
  id: string,
  input: z.infer<typeof issueInput>,
) {
  requireNewsletterAdmin(actor);
  issueBlocks(input.body);
  const row = checked(
    await db()
      .from("squid_newsletter_issues")
      .update({
        title: input.title,
        body: input.body,
        status: "draft",
        updated_at: new Date().toISOString(),
        tested_hash: null,
        test_sent_at: null,
        approved_by: null,
        approved_at: null,
        approved_hash: null,
      })
      .eq("id", id)
      .in("status", ["draft", "approved"])
      .select("id")
      .maybeSingle(),
  );
  if (!row)
    throw new HttpError(
      409,
      "Issues that are sending or sent can’t be edited.",
    );
}
export async function previewIssue(id: string): Promise<NewsletterPreview> {
  const issue = await loadIssue(id);
  return {
    ...renderIssue(issue, {
      unsubscribeUrl: unsubscribePageUrl(),
      postalAddress:
        process.env.NEWSLETTER_POSTAL_ADDRESS ||
        "Set NEWSLETTER_POSTAL_ADDRESS before sending.",
    }),
    hash: contentHash(issue.title, issue.body),
  };
}
// Test sends go only to the signed-in administrator.
export async function sendTestIssue(actor: User, id: string) {
  requireNewsletterAdmin(actor);
  assertSendingAllowed();
  const issue = await loadIssue(id);
  if (issue.status !== "draft")
    throw new HttpError(409, "Only a draft can be sent as a test.");
  const result = await deliver(
    {
      to: actor.email!,
      ...renderIssue(issue, {
        unsubscribeUrl: unsubscribePageUrl(),
        postalAddress: required("NEWSLETTER_POSTAL_ADDRESS"),
        test: true,
      }),
    },
    `squid-newsletter-test/${randomUUID()}`,
  );
  if (!("id" in result))
    throw new HttpError(
      503,
      "Could not send the test email. Please try again shortly.",
    );
  // Record exactly what was tested; approval must match this content.
  const row = checked(
    await db()
      .from("squid_newsletter_issues")
      .update({
        tested_hash: contentHash(issue.title, issue.body),
        test_sent_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "draft")
      .eq("updated_at", issue.updated_at)
      .select("id")
      .maybeSingle(),
  );
  if (!row)
    throw new HttpError(
      409,
      "The draft changed while the test was sending. Send another test.",
    );
}
export async function approveIssue(actor: User, id: string, hash: string) {
  requireNewsletterAdmin(actor);
  rpcResult(
    await db().rpc("squid_newsletter_approve", {
      admin_id: actor.id,
      target_id: id,
      content_hash: hash,
    }),
  );
}
export async function startSend(actor: User, id: string) {
  requireNewsletterAdmin(actor);
  assertSendingAllowed();
  const recipients = rpcResult(
    await db().rpc("squid_newsletter_start_send", {
      admin_id: actor.id,
      target_id: id,
    }),
  ) as number;
  const batch = await sendIssueBatch(id).catch((error) => {
    // Scheduled sending continues the batch if another run holds the lock.
    if (error instanceof LockBusyError) return { sent: 0, done: false };
    throw error;
  });
  return { recipients, ...batch };
}
export async function sendIssueBatch(
  id: string,
  { budgetMs = 35000, intervalMs = SEND_INTERVAL_MS } = {},
) {
  assertSendingAllowed();
  return withLock(`newsletter:${id}`, async () => {
    const started = Date.now();
    const issue = await loadIssue(id);
    // The database already refuses unapproved sends; this also stops a batch
    // if approved content were ever changed outside the admin routes.
    if (
      issue.status !== "sending" ||
      issue.approved_hash !== contentHash(issue.title, issue.body)
    )
      return { sent: 0, done: issue.status === "sent" };
    const postalAddress = required("NEWSLETTER_POSTAL_ADDRESS");
    let sent = 0;
    while (Date.now() - started < budgetMs) {
      const batch = checked(
        await db().rpc("squid_newsletter_pending", {
          target_id: id,
          batch_size: 20,
        }),
      ) as Delivery[];
      if (!batch.length) {
        checked(
          await db()
            .from("squid_newsletter_issues")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", id)
            .eq("status", "sending"),
        );
        return { sent, done: true };
      }
      for (const delivery of batch) {
        if (Date.now() - started >= budgetMs) return { sent, done: false };
        const result = await deliver(
          {
            to: delivery.email,
            ...renderIssue(issue, {
              unsubscribeUrl: unsubscribePageUrl(delivery.id),
              postalAddress,
              link: (href) => trackedLink(delivery.id, href),
            }),
            headers: {
              "List-Unsubscribe": `<${oneClickUrl(delivery.id)}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            tags: [{ name: "squid_newsletter_delivery", value: delivery.id }],
          },
          `squid-newsletter/${delivery.id}`,
        );
        if ("retry" in result) return { sent, done: false };
        checked(
          await db()
            .from("squid_newsletter_deliveries")
            .update(
              "id" in result
                ? {
                    status: "sent",
                    provider_id: result.id || null,
                    sent_at: new Date().toISOString(),
                  }
                : { status: "failed" },
            )
            .eq("id", delivery.id)
            .eq("status", "pending"),
        );
        if ("id" in result) sent++;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return { sent, done: false };
  });
}
// Scheduled continuation. Does nothing, not even a database read, while
// sending is disabled.
export async function continueSending() {
  const config = newsletterConfig();
  if (!config.enabled || config.missing.length) return { skipped: true };
  const issues = checked(
    await db()
      .from("squid_newsletter_issues")
      .select("id")
      .eq("status", "sending")
      .order("send_started_at")
      .limit(1),
  ) as { id: string }[];
  let sent = 0;
  for (const issue of issues) {
    try {
      sent += (await sendIssueBatch(issue.id)).sent;
    } catch (error) {
      if (!(error instanceof LockBusyError)) throw error;
    }
  }
  return { skipped: false, sent };
}

// Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body".
export function verifyResendWebhook(
  raw: string,
  headers: Pick<Headers, "get">,
  now = Date.now(),
) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret)
    throw new HttpError(503, "Newsletter webhooks are not configured.");
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (
    !id ||
    !signatures ||
    !/^\d{1,12}$/.test(timestamp ?? "") ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw new HttpError(400, "Invalid webhook signature.");
  const expected = createHmac(
    "sha256",
    Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
  )
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  if (
    !signatures.split(" ").some((entry) => {
      const [version, value] = entry.split(",");
      return version === "v1" && Boolean(value) && same(value, expected);
    })
  )
    throw new HttpError(400, "Invalid webhook signature.");
}
const providerEvent = z.object({
  type: z.string(),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      to: z.array(z.string().max(254)).max(50).optional(),
      bounce: z.object({ type: z.string().optional() }).loose().optional(),
    })
    .loose(),
});
export async function recordProviderEvent(payload: unknown) {
  const event = providerEvent.parse(payload);
  const kind =
    event.type === "email.bounced"
      ? "bounced"
      : event.type === "email.complained"
        ? "complained"
        : null;
  // Temporary bounces are retried by the provider and do not suppress.
  if (
    !kind ||
    (kind === "bounced" &&
      /transient|temporary/i.test(event.data.bounce?.type ?? ""))
  )
    return false;
  checked(
    await db().rpc("squid_newsletter_bounce", {
      provider: event.data.email_id ?? "",
      addresses: event.data.to ?? [],
      kind,
    }),
  );
  return true;
}
