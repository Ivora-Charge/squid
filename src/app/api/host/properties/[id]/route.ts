import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { ownedProperty, provision, publish } from "@/lib/server/properties";
import { checked, db, withLock } from "@/lib/server/db";
import {
  seedCredentials,
  configureCredentials,
} from "@/lib/server/charger-credentials";
export const maxDuration = 60;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const { id } = await context.params;
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("resume") }),
        z.object({ action: z.literal("publish") }),
        z.object({ action: z.literal("pause") }),
        z.object({ action: z.literal("credentials") }).strict(),
      ])
      .parse(await request.json());
    const property = await ownedProperty(host.id, id);
    if (input.action === "resume")
      return NextResponse.json({ property: await provision(host.id, id) });
    if (input.action === "publish") await publish(host.id, id);
    if (input.action === "pause")
      checked(
        await db()
          .from("squid_properties")
          .update({ published: false })
          .eq("id", id)
          .eq("host_id", host.id),
      );
    if (input.action === "credentials") {
      if (!property.station_id)
        throw new Error("Charger setup is incomplete. Resume setup first.");
      await withLock(`property:${id}`, async () => {
        await seedCredentials(id);
        await configureCredentials(property);
      });
    }
    return NextResponse.json({ property: await ownedProperty(host.id, id) });
  } catch (error) {
    return failure(error);
  }
}
