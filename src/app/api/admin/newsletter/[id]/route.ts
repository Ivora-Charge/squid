import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/admin";
import {
  approveIssue,
  issueInput,
  previewIssue,
  saveIssue,
  sendTestIssue,
  startSend,
} from "@/lib/server/newsletter";
import { failure, sameOrigin } from "@/lib/server/security";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const action = z.discriminatedUnion("action", [
  issueInput.extend({ action: z.literal("save") }).strict(),
  z.object({ action: z.literal("preview") }).strict(),
  z.object({ action: z.literal("test") }).strict(),
  z
    .object({
      action: z.literal("approve"),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ action: z.literal("send") }).strict(),
]);
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const actor = await requireAdmin();
    const { id } = z.object({ id: z.uuid() }).parse(await context.params);
    const input = action.parse(await request.json());
    if (input.action === "preview")
      return NextResponse.json(await previewIssue(id), { headers });
    if (input.action === "save") await saveIssue(actor, id, input);
    else if (input.action === "test") await sendTestIssue(actor, id);
    else if (input.action === "approve")
      await approveIssue(actor, id, input.hash);
    else return NextResponse.json(await startSend(actor, id), { headers });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    return failure(error);
  }
}
