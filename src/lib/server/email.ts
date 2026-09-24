import "server-only";
import { createHash } from "node:crypto";
import { appUrl, required } from "./config";
import { HttpError } from "./security";
export { reserveSignInEmail } from "./auth-limits";

type EmailPurpose = "signin" | "signup" | "recovery";
export function signInLink(
  tokenHash: string,
  purpose: EmailPurpose = "signin",
) {
  const link = new URL(
    purpose === "recovery" ? "/login/reset" : "/login/confirm",
    appUrl(),
  );
  // Fragments stay in the browser instead of appearing in server request logs.
  link.hash = new URLSearchParams({ token_hash: tokenHash }).toString();
  return link.toString();
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function signInEmail(link: string, purpose: EmailPurpose = "signin") {
  const url = escapeHtml(link);
  const copy = {
    signin: {
      subject: "Your sign-in link",
      title: "A little good energy awaits.",
      body: "Welcome home. Your chargers, guests, and earnings are just a tap away.",
      action: "Sign in to Squid",
      note: "Confirm on the next screen to enter your workspace.",
    },
    signup: {
      subject: "Confirm your email",
      title: "Your next chapter starts here.",
      body: "Confirm your email to finish creating your Squid host account. After that, sign in with your email and password.",
      action: "Confirm your email",
      note: "Confirm on the next screen to open your workspace.",
    },
    recovery: {
      subject: "Reset your Squid password",
      title: "A fresh start.",
      body: "Choose a new password for your Squid account. Your chargers, guests, and earnings will be right where you left them.",
      action: "Reset your password",
      note: "Your password stays the same until you save a new one on the next screen.",
    },
  }[purpose];
  return {
    subject: `${copy.subject} · Squid by Ivora`,
    text: `${copy.title}\n\n${copy.body}\n\n${copy.action}:\n${link}\n\n${copy.note} This link can be used once. If you didn’t request it, you can ignore this email.\n\nSquid by Ivora · A little charge. A better stay.`,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${copy.subject}</title></head><body style="margin:0;background:#111513;color:#eeefe8;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111513"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#191e1b;border:1px solid #2d342e;border-radius:18px"><tr><td style="padding:36px"><div style="font-size:34px;font-weight:bold;letter-spacing:-2px;color:#fa9477">squid</div><div style="margin:2px 0 36px;font-size:10px;letter-spacing:3px;color:#99a298">BY IVORA</div><h1 style="font-size:29px;line-height:1.2;margin:0 0 20px;color:#eeefe8">${copy.title}</h1><p style="font-size:16px;line-height:1.6;color:#b5beb3">${copy.body}</p><p style="margin:30px 0"><a href="${url}" style="display:inline-block;background:#fa9477;color:#171b18;text-decoration:none;font-size:16px;font-weight:bold;padding:16px 24px;border-radius:8px">${copy.action} →</a></p><p style="font-size:13px;line-height:1.6;color:#99a298">${copy.note} This link can be used once. If you didn’t request it, you can ignore this email.</p><p style="font-size:12px;line-height:1.6;color:#99a298;word-break:break-all">Button not working? Open this link:<br><a href="${url}" style="color:#bdd9ae">${url}</a></p><p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #2d342e;color:#99a298;font-size:12px">Squid by Ivora · A little charge. A better stay.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
export async function sendSignInEmail(
  email: string,
  tokenHash: string,
  purpose: EmailPurpose = "signin",
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `squid-${purpose === "signin" ? "sign-in" : purpose}/${createHash("sha256").update(tokenHash).digest("hex")}`,
    },
    body: JSON.stringify({
      from: required("RESEND_FROM_EMAIL"),
      to: [email],
      ...signInEmail(signInLink(tokenHash, purpose), purpose),
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error("[Squid email] Delivery request failed", {
      status: response.status,
    });
    throw new HttpError(
      503,
      "Could not send your email. Please try again shortly.",
    );
  }
}
