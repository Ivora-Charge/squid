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
  newPasswordInput,
} from "@/lib/server/auth-input";

export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { email, password } = z
      .object({ email: emailInput, password: newPasswordInput })
      .parse(await request.json());
    await reserveSignInEmail(email, request);
    if (process.env.RESEND_API_KEY) {
      const { data, error } = await db().auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { redirectTo: `${appUrl()}/login/confirm` },
      });
      // Do not expose whether the address is already registered or overwrite an
      // existing account's password. Its owner can use password recovery.
      if (
        error?.code === "email_exists" ||
        error?.code === "user_already_exists"
      )
        return authSuccess({ ok: true, confirmationRequired: true });
      if (error || !data.properties?.hashed_token)
        authProviderFailure(
          error || {},
          "Could not create your account. Please try again shortly.",
        );
      await sendSignInEmail(email, data.properties.hashed_token, "signup");
      return authSuccess({ ok: true, confirmationRequired: true });
    }
    const { data, error } = await (
      await auth()
    ).auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${appUrl()}/auth/callback` },
    });
    if (error?.code === "email_exists" || error?.code === "user_already_exists")
      return authSuccess({ ok: true, confirmationRequired: true });
    if (error)
      authProviderFailure(
        error,
        "Could not create your account. Please try again shortly.",
      );
    return authSuccess({ ok: true, confirmationRequired: !data.session });
  } catch (error) {
    return failure(error);
  }
}
