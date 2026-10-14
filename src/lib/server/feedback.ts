import "server-only";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { HttpError } from "./http-error";

export const feedbackInput = z
  .object({
    id: z.uuid(),
    category: z.enum(["issue", "idea", "other"]),
    rating: z.number().int().min(1).max(5).nullable().default(null),
    message: z.string().trim().min(3).max(2000),
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.union([z.email(), z.literal("")]))
      .default("")
      .transform((value) => (value ? value.toLowerCase() : null)),
    page: z.string().max(200).default("/"),
    website: z.string().max(1000).default(""),
  })
  .strict();

export function feedbackPage(value: string) {
  const path = value.split(/[?#]/)[0];
  if (/^\/c\//.test(path)) return "/c/[charger]";
  if (/^\/session\//.test(path)) return "/session/[session]";
  return [
    "/",
    "/dashboard",
    "/demo",
    "/developers",
    "/privacy",
    "/terms",
    "/login",
    "/login/confirm",
    "/login/reset",
    "/admin",
  ].includes(path)
    ? path
    : "/";
}
export async function feedbackBody(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > 12000)
    throw new HttpError(413, "Your feedback is too long.");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 12000)
    throw new HttpError(413, "Your feedback is too long.");
  try {
    return feedbackInput.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new HttpError(400, "Please check your feedback and try again.");
    throw error;
  }
}
