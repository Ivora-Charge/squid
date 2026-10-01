import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, setFeedbackStatus } from "@/lib/server/admin";
import { failure, sameOrigin } from "@/lib/server/security";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const actor = await requireAdmin();
    const { id } = z.object({ id: z.uuid() }).parse(await context.params);
    const { status } = z
      .object({ status: z.enum(["new", "reviewing", "resolved"]) })
      .strict()
      .parse(await request.json());
    await setFeedbackStatus(actor, id, status);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
