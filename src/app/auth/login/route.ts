import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, db } from "@/lib/server/db";
import { appUrl } from "@/lib/server/config";
import { failure, sameOrigin } from "@/lib/server/security";
import { reserveSignInEmail, sendSignInEmail } from "@/lib/server/email";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { email } = z
      .object({
        email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      })
      .parse(await request.json());
    if (process.env.RESEND_API_KEY) {
      await reserveSignInEmail(email, request);
      const { data, error } = await db().auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${appUrl()}/login/confirm` },
      });
      if (error || !data.properties?.hashed_token)
        throw new Error("Could not generate the sign-in link.");
      await sendSignInEmail(email, data.properties.hashed_token);
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const { error } = await (
      await auth()
    ).auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${appUrl()}/auth/callback` },
    });
    if (error)
      return NextResponse.json(
        {
          error:
            "Could not send a sign-in link. Please wait a minute and try again.",
        },
        { status: 429 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
