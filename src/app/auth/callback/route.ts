import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server/db";
import { appUrl } from "@/lib/server/config";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code && !request.nextUrl.searchParams.has("error")) {
    const { error } = await (await auth()).auth.exchangeCodeForSession(code);
    if (!error) {
      // A fixed allowlist prevents external or protocol-relative redirects.
      const next =
        request.nextUrl.searchParams.get("next") === "/login/reset"
          ? "/login/reset"
          : "/dashboard";
      return NextResponse.redirect(`${appUrl()}${next}`, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  }
  return NextResponse.redirect(`${appUrl()}/login?error=auth`, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
