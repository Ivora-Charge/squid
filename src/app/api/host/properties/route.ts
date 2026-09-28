import { NextRequest, NextResponse } from "next/server";
import { checked, db } from "@/lib/server/db";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { propertyInput, provision } from "@/lib/server/properties";
import { readAddress } from "@/lib/server/addresses";
import { seedCredentials } from "@/lib/server/charger-credentials";
import { stationIdentity } from "@/lib/onboarding";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const input = propertyInput.parse(await request.json());
    const { data: existing, error } = await db()
      .from("squid_properties")
      .select("id")
      .eq("id", input.id)
      .eq("host_id", host.id)
      .maybeSingle();
    checked({ data: existing, error });
    if (!existing) {
      const { addressToken, ...fields } = input;
      checked(
        await db()
          .from("squid_properties")
          .insert({
            ...fields,
            ...readAddress(addressToken, host.id),
            host_id: host.id,
            station_name: stationIdentity(input.name, input.id),
          }),
      );
    }
    await seedCredentials(input.id);
    const property = await provision(host.id, input.id);
    return NextResponse.json({ property });
  } catch (error) {
    return failure(error);
  }
}
