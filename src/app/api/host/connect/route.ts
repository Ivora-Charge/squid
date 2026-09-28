import { NextRequest, NextResponse } from "next/server";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { onboarding } from "@/lib/server/stripe";
import { z } from "zod";
import { ownedProperty } from "@/lib/server/properties";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    const { propertyId } = z
      .object({ propertyId: z.uuid().optional() })
      .parse(await request.json());
    if (propertyId) await ownedProperty(host.id, propertyId);
    return NextResponse.json({
      url: await onboarding(host.id, host.email!, propertyId),
    });
  } catch (error) {
    return failure(error);
  }
}
