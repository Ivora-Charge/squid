import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/server/db";
import { supabaseConfigured } from "@/lib/server/config";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";
import {
  authSuccess,
  authProviderFailure,
  emailInput,
  newPasswordInput,
} from "@/lib/server/auth-input";
import {
  reservePasswordSignIn,
  reservePasswordUpdate,
} from "@/lib/server/auth-limits";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { email, password } = z
      .object({
        email: emailInput,
        // Existing accounts may have a password shorter than our signup minimum.
        password: z.string().min(1).max(128),
      })
      .parse(await request.json());
    await reservePasswordSignIn(email, request);
    const { data, error } = await (
      await auth()
    ).auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === "email_not_confirmed")
        throw new HttpError(
          401,
          "Confirm your email before signing in. You can request an email sign-in link below.",
        );
      if (error.code === "invalid_credentials")
        throw new HttpError(401, "Email or password is incorrect.");
      authProviderFailure(
        error,
        "Could not sign in right now. Please try again shortly.",
      );
    }
    if (!data.session || !data.user)
      throw new HttpError(401, "Email or password is incorrect.");
    return authSuccess();
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    sameOrigin(request);
    const { password } = z
      .object({ password: newPasswordInput })
      .parse(await request.json());
    if (!supabaseConfigured())
      throw new HttpError(401, "Please sign in to continue.");
    const client = await auth();
    const { data, error: identityError } = await client.auth.getUser();
    if (identityError || !data.user)
      throw new HttpError(
        401,
        "Open your password reset link or sign in before setting a password.",
      );
    await reservePasswordUpdate(data.user.id);
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password")
        throw new HttpError(
          400,
          "Choose a different password from your current one.",
        );
      if (error.code === "reauthentication_needed")
        throw new HttpError(
          401,
          "Request a fresh password reset link to change your password.",
        );
      authProviderFailure(
        error,
        "Could not update your password. Please try again shortly.",
      );
    }
    return authSuccess();
  } catch (error) {
    return failure(error);
  }
}
