import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { reserveAddressSearch } from "@/lib/server/auth-limits";
import { selectAddress, suggestAddresses } from "@/lib/server/addresses";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("suggest"),
          query: z.string().trim().min(3).max(200),
          session: z.uuid(),
        }),
        z.object({
          action: z.literal("select"),
          placeId: z.string().min(1).max(300),
          session: z.uuid(),
        }),
      ])
      .parse(await request.json());
    await reserveAddressSearch(host.id);
    return NextResponse.json(
      input.action === "suggest"
        ? { suggestions: await suggestAddresses(input.query, input.session) }
        : {
            address: await selectAddress(input.placeId, input.session, host.id),
          },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
