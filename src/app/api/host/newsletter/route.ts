import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { user } from "@/lib/server/db";
import { authorizeWorkspace } from "@/lib/server/admin";
import { supabaseConfigured } from "@/lib/server/config";
import { setNewsletterConsent } from "@/lib/server/newsletter";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = supabaseConfigured() ? await user() : null;
    if (!actor) throw new HttpError(401, "Please sign in to continue.");
    const { subscribed } = z
      .object({ subscribed: z.boolean() })
      .strict()
      .parse(await request.json());
    const { actingAs } = await authorizeWorkspace(actor, request);
    // Consent belongs to the host. An administrator in tenant access cannot
    // give or withdraw it for them.
    if (actingAs)
      throw new HttpError(
        403,
        "Only the host can change their newsletter preference.",
      );
    return NextResponse.json(await setNewsletterConsent(actor.id, subscribed), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
