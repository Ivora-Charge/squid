import { NextRequest, NextResponse } from "next/server";
import {
  recordProviderEvent,
  verifyResendWebhook,
} from "@/lib/server/newsletter";
import { failure, HttpError } from "@/lib/server/security";

// Resend delivery events. Bounces and complaints join the suppression list.
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > 100000) throw new HttpError(413, "Payload too large.");
    verifyResendWebhook(raw, request.headers);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid payload.");
    }
    await recordProviderEvent(payload);
    return NextResponse.json({ received: true });
  } catch (error) {
    return failure(error);
  }
}
