import { NextRequest } from "next/server";
import { auth } from "@/lib/server/db";
import { appUrl, required } from "@/lib/server/config";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";
import { authSuccess } from "@/lib/server/auth-input";
import { reserveGoogleSignIn } from "@/lib/server/auth-limits";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    await reserveGoogleSignIn(request);
    const response = await fetch(
      `${required("SUPABASE_URL")}/auth/v1/settings`,
      {
        headers: { apikey: required("SUPABASE_ANON_KEY") },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        503,
        "Could not connect to Google sign-in. Please try again shortly.",
      );
    const settings = await response.json();
    if (settings.external?.google !== true)
      throw new HttpError(
        503,
        "Google sign-in is not available yet. Please use email and password.",
      );
    const { data, error } = await (
      await auth()
    ).auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${appUrl()}/auth/callback`,
        queryParams: { prompt: "select_account" },
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url)
      throw new HttpError(
        503,
        "Could not start Google sign-in. Please try again shortly.",
      );
    return authSuccess({ url: data.url });
  } catch (error) {
    return failure(error);
  }
}
