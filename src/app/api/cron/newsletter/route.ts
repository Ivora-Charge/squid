import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { continueSending } from "@/lib/server/newsletter";
import { failure } from "@/lib/server/security";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const actual = request.headers.get("authorization") ?? "";
  if (
    !process.env.CRON_SECRET ||
    expected.length !== actual.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await continueSending());
  } catch (error) {
    return failure(error);
  }
}
