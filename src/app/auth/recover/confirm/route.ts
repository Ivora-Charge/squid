import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/server/db";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";
import { authSuccess, authTokenInput } from "@/lib/server/auth-input";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token_hash } = z
      .object({ token_hash: authTokenInput })
      .parse(await request.json());
    const { error } = await (
      await auth()
    ).auth.verifyOtp({ token_hash, type: "recovery" });
    if (error)
      throw new HttpError(
        401,
        "This reset link has expired or was already used. Please request a new one.",
      );
    return authSuccess();
  } catch (error) {
    return failure(error);
  }
}
