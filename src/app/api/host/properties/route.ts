import { NextRequest, NextResponse } from "next/server";
import { checked, db } from "@/lib/server/db";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { propertyInput, provision } from "@/lib/server/properties";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const input = propertyInput.parse(await request.json());
    const { data: existing } = await db()
      .from("squid_properties")
      .select("id")
      .eq("id", input.id)
      .eq("host_id", host.id)
      .maybeSingle();
    if (!existing)
      checked(
        await db()
          .from("squid_properties")
          .insert({
            ...input,
            host_id: host.id,
            station_name: `sq-${input.id.replaceAll("-", "").slice(0, 24)}`,
          }),
      );
    const property = await provision(host.id, input.id);
    return NextResponse.json({ property });
  } catch (error) {
    return failure(error);
  }
}
