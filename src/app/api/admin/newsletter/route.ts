import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import {
  createIssue,
  issueInput,
  newsletterOverview,
} from "@/lib/server/newsletter";
import { failure, sameOrigin } from "@/lib/server/security";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await newsletterOverview(), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await requireAdmin();
    const id = await createIssue(actor, issueInput.parse(await request.json()));
    return NextResponse.json({ id }, { headers });
  } catch (error) {
    return failure(error);
  }
}
