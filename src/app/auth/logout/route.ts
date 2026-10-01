import { NextRequest, NextResponse } from "next/server";
import { auth, user } from "@/lib/server/db";
import { endTenantAccess } from "@/lib/server/admin";
import { failure, sameOrigin } from "@/lib/server/security";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    try {
      await endTenantAccess(await user());
    } catch {
      /* The cookie is cleared even if revocation storage is unavailable. */
    }
    await (await auth()).auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
