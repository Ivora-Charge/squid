import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server/db";
import { appUrl } from "@/lib/server/config";
import { z } from "zod";
import { failure, HttpError, sameOrigin } from "@/lib/server/security";
import { signInLink } from "@/lib/server/email";
const token = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
export async function GET(request: NextRequest) {
  const parsed = token.safeParse(
    request.nextUrl.searchParams.get("token_hash"),
  );
  // Existing Supabase email templates can still use this URL. A GET never
  // consumes the link, so an email security scanner cannot sign in on its own.
  if (parsed.success)
    return NextResponse.redirect(signInLink(parsed.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  return NextResponse.redirect(`${appUrl()}/login?error=expired`);
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token_hash } = z
      .object({ token_hash: token })
      .parse(await request.json());
    const { error } = await (
      await auth()
    ).auth.verifyOtp({ token_hash, type: "email" });
    if (error)
      throw new HttpError(
        401,
        "This sign-in link has expired or was already used. Please request a new one.",
      );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
