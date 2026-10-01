import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  endTenantAccess,
  requireAdmin,
  startTenantAccess,
} from "@/lib/server/admin";
import { failure, sameOrigin } from "@/lib/server/security";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await requireAdmin();
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("start"),
            tenantId: z.uuid(),
            reason: z.string().trim().min(3).max(240),
          })
          .strict(),
        z.object({ action: z.literal("end") }).strict(),
      ])
      .parse(await request.json());
    if (input.action === "start")
      await startTenantAccess(actor, input.tenantId, input.reason);
    else await endTenantAccess(actor);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
