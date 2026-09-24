import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server/db";
import { failure, sameOrigin } from "@/lib/server/security";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    await (await auth()).auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
