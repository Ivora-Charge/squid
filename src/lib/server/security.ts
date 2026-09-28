import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { appUrl, required, supabaseConfigured } from "./config";
import { user } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireHost() {
  if (!supabaseConfigured())
    throw new HttpError(401, "Please sign in to continue.");
  const host = await user();
  if (!host) throw new HttpError(401, "Please sign in to continue.");
  return host;
}
export function sameOrigin(request: NextRequest) {
  const expected = new URL(appUrl()).origin;
  if (request.headers.get("origin") !== expected)
    throw new HttpError(403, "This request must come from Squid.");
}
export function guestToken(id: string) {
  return createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`squid-guest:${id}`)
    .digest("hex");
}
export async function issueGuestCookie(id: string) {
  (await cookies()).set(`squid_guest_${id}`, guestToken(id), {
    httpOnly: true,
    secure: appUrl().startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
export async function requireGuest(id: string) {
  const value = (await cookies()).get(`squid_guest_${id}`)?.value || "";
  if (!value)
    throw new HttpError(
      403,
      "Open this session in the browser where you started charging.",
    );
  const expected = guestToken(id);
  if (
    value.length !== expected.length ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  )
    throw new HttpError(
      403,
      "Open this session in the browser where you started charging.",
    );
}
// Ivora's stable error codes, mapped to what a host can act on.
const IVORA_MESSAGES: Record<string, { status: number; message: string }> = {
  station_offline: {
    status: 409,
    message: "Your charger is offline. Connect it and try again.",
  },
  station_online: {
    status: 409,
    message:
      "Disconnect your charger before preparing its connection password.",
  },
  request_in_progress: {
    status: 409,
    message: "This action is already in progress. Please retry shortly.",
  },
  rate_limited: {
    status: 429,
    message: "Too many charger requests right now. Try again in a minute.",
  },
  outcome_unknown: {
    status: 503,
    message:
      "Ivora didn’t confirm that request. Refresh setup in a moment; nothing was duplicated.",
  },
  csms_unavailable: {
    status: 503,
    message: "The charger network is unavailable. Please try again shortly.",
  },
  csms_request_failed: {
    status: 503,
    message: "The charger network is unavailable. Please try again shortly.",
  },
  temporarily_unavailable: {
    status: 503,
    message: "The charger network is unavailable. Please try again shortly.",
  },
};
export function failure(error: unknown) {
  if (error instanceof Error && error.name === "IvoraError") {
    const { code, requestId } = error as { code?: string; requestId?: string };
    console.error("[Squid] IvoraError", code, requestId ?? "");
    const known = IVORA_MESSAGES[code ?? ""];
    if (known)
      return NextResponse.json(
        { error: known.message },
        { status: known.status },
      );
  }
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof Error && error.name === "ZodError")
    return NextResponse.json(
      { error: "Please check the form fields and try again." },
      { status: 400 },
    );
  // Never return processor errors, credentials, internal payloads, or stack traces.
  const message =
    error instanceof Error &&
    /^(Missing |Database setup|This action is already|The final bill|Connect Stripe|Your charger|Charger setup|No available|Could not save|Payment authorization)/.test(
      error.message,
    )
      ? error.message
      : "We couldn’t complete that action. Please try again; your original request is saved.";
  console.error(
    "[Squid]",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json({ error: message }, { status: 503 });
}
