import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { HttpError } from "./security";

export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
export const newPasswordInput = z
  .string()
  .min(8)
  .max(72)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72);
export const authTokenInput = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
export function authSuccess(data: Record<string, unknown> = { ok: true }) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function authProviderFailure(
  error: { code?: string; status?: number },
  message: string,
): never {
  if (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  )
    throw new HttpError(
      429,
      "Too many attempts. Please wait a few minutes and try again.",
    );
  if (error.code === "weak_password")
    throw new HttpError(
      400,
      "Choose a stronger password with at least 8 characters, mixing letters, numbers, and symbols.",
    );
  throw new HttpError(503, message);
}
