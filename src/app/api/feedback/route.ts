import { NextRequest, NextResponse } from "next/server";
import { checked, db, user } from "@/lib/server/db";
import { authorizeWorkspace } from "@/lib/server/admin";
import { feedbackBody, feedbackPage } from "@/lib/server/feedback";
import { reserveFeedback } from "@/lib/server/auth-limits";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";
import { supabaseConfigured } from "@/lib/server/config";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await feedbackBody(request);
    if (input.website) return NextResponse.json({ ok: true });
    const actor = supabaseConfigured() ? await user() : null;
    await reserveFeedback(request, actor?.id);
    const page = feedbackPage(input.page);
    const context =
      actor && page === "/dashboard"
        ? await authorizeWorkspace(actor, request)
        : null;
    checked(
      await db()
        .from("squid_feedback")
        .upsert(
          {
            id: input.id,
            submitted_by: actor?.id ?? null,
            tenant_id: context?.host.id ?? actor?.id ?? null,
            email: input.email,
            category: input.category,
            rating: input.rating,
            message: input.message,
            page_path: page,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
    );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof HttpError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return failure(error);
    console.error(
      "[Squid] feedback",
      error instanceof Error ? error.name : "UnknownError",
    );
    return failure(
      new HttpError(503, "Could not send your feedback. Please try again."),
    );
  }
}
