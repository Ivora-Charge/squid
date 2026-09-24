import { NextRequest } from "next/server";
import { z } from "zod";
import { auth, db } from "@/lib/server/db";
import { appUrl } from "@/lib/server/config";
import { failure, sameOrigin } from "@/lib/server/security";
import { reserveSignInEmail, sendSignInEmail } from "@/lib/server/email";
import {
  authSuccess,
  authProviderFailure,
  emailInput,
} from "@/lib/server/auth-input";

export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { email } = z
      .object({ email: emailInput })
      .parse(await request.json());
    await reserveSignInEmail(email, request);
    if (process.env.RESEND_API_KEY) {
      const { data, error } = await db().auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${appUrl()}/login/reset` },
      });
      // Recovery must neither create new users nor reveal account existence.
      if (error?.code === "user_not_found") return authSuccess();
      if (error || !data.properties?.hashed_token)
        authProviderFailure(
          error || {},
          "Could not request a reset email. Please try again shortly.",
        );
      await sendSignInEmail(email, data.properties.hashed_token, "recovery");
      return authSuccess();
    }
    const { error } = await (
      await auth()
    ).auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl()}/auth/callback?next=/login/reset`,
    });
    if (error)
      authProviderFailure(
        error,
        "Could not request a reset email. Please try again shortly.",
      );
    return authSuccess();
  } catch (error) {
    return failure(error);
  }
}
