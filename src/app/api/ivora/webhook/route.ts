import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { verifyWebhookSignature } from "@/lib/server/ivora";
import { reconcile } from "@/lib/server/sessions";
export const maxDuration = 60;
const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  tenant_id: z.number(),
  resource_id: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
// Ivora delivers signed events at least once and retries anything but a 2xx
// for about a day. Verify, record the event id once, acknowledge, then
// reconcile the affected session after the response so Stripe calls never
// hit Ivora's 10-second delivery timeout.
export async function POST(request: NextRequest) {
  const secret = process.env.IVORA_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Webhook not configured." },
      { status: 503 },
    );
  const body = await request.text();
  const verdict = verifyWebhookSignature(
    secret,
    request.headers.get("ivora-signature"),
    body,
  );
  if (verdict !== "ok")
    return NextResponse.json(
      {
        error: verdict === "stale" ? "Stale signature." : "Invalid signature.",
      },
      { status: verdict === "stale" ? 400 : 401 },
    );
  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });
  }
  if (String(event.tenant_id) !== process.env.IVORA_TENANT_ID)
    return NextResponse.json({ error: "Unknown tenant." }, { status: 400 });
  const insertion = await db()
    .from("squid_ivora_events")
    .insert({
      id: event.id,
      type: event.type,
      resource_id: event.resource_id ?? null,
    });
  if (insertion.error?.code === "23505")
    return NextResponse.json({ received: true, duplicate: true });
  if (insertion.error)
    return NextResponse.json(
      { error: "Could not record the event." },
      { status: 503 },
    );
  const ivoraSessionId = sessionIdFrom(event);
  if (!ivoraSessionId) return NextResponse.json({ received: true });
  const { data } = await db()
    .from("squid_sessions")
    .select("id")
    .eq("ivora_session_id", ivoraSessionId)
    .maybeSingle();
  if (!data) return NextResponse.json({ received: true, unknown: true });
  after(() =>
    reconcile(data.id).catch((error: unknown) =>
      console.error(
        "[Squid] webhook reconcile",
        error instanceof Error ? error.name : "UnknownError",
      ),
    ),
  );
  return NextResponse.json({ received: true }, { status: 202 });
}
function sessionIdFrom(event: z.infer<typeof eventSchema>) {
  if (
    event.type !== "charging_session.status_changed" &&
    event.type !== "bill.finalized"
  )
    return null;
  const data = event.data as {
    session_id?: unknown;
    session?: { id?: unknown };
  };
  const id = data.session_id ?? data.session?.id;
  return typeof id === "string" && id ? id : null;
}
