import "server-only";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { required } from "./config";
import { db } from "./db";
import { HttpError } from "./security";

function digest(value: string) {
  return createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update(value)
    .digest("hex");
}
function source(request: NextRequest) {
  // Only trust the client address supplied by Vercel's proxy.
  return process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    : "local";
}
async function takeQuota(
  key: string,
  quota: number,
  periodSeconds: number,
  message: string,
) {
  const { data, error } = await db().rpc("squid_take_rate_limit", {
    bucket_key: key,
    quota,
    period_seconds: periodSeconds,
  });
  if (error)
    throw new Error(
      "Database setup is incomplete. Apply all Squid migrations.",
    );
  if (!data) throw new HttpError(429, message);
}
export async function reserveSignInEmail(email: string, request: NextRequest) {
  const message = "Please wait a minute before requesting another email.";
  await takeQuota(`email-source:${digest(source(request))}`, 10, 600, message);
  await takeQuota(`email-recipient:${digest(email)}`, 1, 60, message);
}
export async function reservePasswordSignIn(
  email: string,
  request: NextRequest,
) {
  const message = "Too many sign-in attempts. Please try again in ten minutes.";
  await takeQuota(
    `password-source:${digest(source(request))}`,
    30,
    600,
    message,
  );
  await takeQuota(`password-account:${digest(email)}`, 10, 600, message);
}
export async function reservePasswordUpdate(userId: string) {
  await takeQuota(
    `password-change:${digest(userId)}`,
    5,
    600,
    "Please wait before changing your password again.",
  );
}
export async function reserveGoogleSignIn(request: NextRequest) {
  await takeQuota(
    `google-source:${digest(source(request))}`,
    30,
    600,
    "Too many sign-in attempts. Please try again in ten minutes.",
  );
}
export async function reserveAddressSearch(userId: string) {
  await takeQuota(
    `address:${digest(userId)}`,
    120,
    600,
    "Please wait a few minutes before searching again.",
  );
}
