import { NextRequest, NextResponse } from "next/server";
import { failure, requireHost, sameOrigin } from "@/lib/server/security";
import { onboarding } from "@/lib/server/stripe";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const host = await requireHost();
    return NextResponse.json({ url: await onboarding(host.id, host.email!) });
  } catch (error) {
    return failure(error);
  }
}
