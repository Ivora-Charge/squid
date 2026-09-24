import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  failure,
  HttpError,
  requireHost,
  sameOrigin,
} from "@/lib/server/security";
import { checked, db } from "@/lib/server/db";
import { loadSession, reconcile } from "@/lib/server/sessions";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const { id } = z.object({ id: z.uuid() }).parse(await request.json());
    const session = await loadSession(id);
    if (session.host_id !== host.id)
      throw new HttpError(404, "Session not found.");
    if (session.status !== "completed" || !session.total_cents)
      throw new HttpError(409, "Only completed paid sessions can be refunded.");
    checked(
      await db()
        .from("squid_sessions")
        .update({ refund_requested: true })
        .eq("id", id)
        .eq("host_id", host.id),
    );
    await reconcile(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
