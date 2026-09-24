import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failure, issueGuestCookie, sameOrigin } from "@/lib/server/security";
import { createCheckout } from "@/lib/server/sessions";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { slug, requestId } = z
      .object({
        slug: z.string().regex(/^[a-zA-Z0-9-]{1,60}$/),
        requestId: z.uuid(),
      })
      .parse(await request.json());
    const session = await createCheckout(slug, requestId);
    await issueGuestCookie(session.id);
    return NextResponse.json({ id: session.id, url: session.checkout_url });
  } catch (error) {
    return failure(error);
  }
}
