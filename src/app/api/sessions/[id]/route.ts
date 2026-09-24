import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failure, requireGuest, sameOrigin } from "@/lib/server/security";
import { checked, db } from "@/lib/server/db";
import { loadSession, publicSession, reconcile } from "@/lib/server/sessions";
export const maxDuration = 60;
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireGuest(id);
    return NextResponse.json(
      { session: publicSession(await loadSession(id)) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    await requireGuest(id);
    const { action } = z
      .object({ action: z.enum(["sync", "stop"]) })
      .parse(await request.json());
    if (action === "stop")
      checked(
        await db()
          .from("squid_sessions")
          .update({ stop_requested: true })
          .eq("id", id),
      );
    return NextResponse.json({ session: publicSession(await reconcile(id)) });
  } catch (error) {
    return failure(error);
  }
}
