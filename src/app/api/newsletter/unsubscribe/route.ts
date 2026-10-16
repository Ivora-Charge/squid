import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/server/config";
import { unsubscribe } from "@/lib/server/newsletter";
import { failure } from "@/lib/server/security";

// RFC 8058 one-click unsubscribe. Mail providers POST
// "List-Unsubscribe=One-Click" to the List-Unsubscribe URL without cookies or
// an Origin header; the signed token is the only credential. The unsubscribe
// page submits the same form.
export async function POST(request: NextRequest) {
  try {
    await unsubscribe(request.nextUrl.searchParams.get("t") ?? "");
    if (request.headers.get("accept")?.includes("text/html"))
      return NextResponse.redirect(
        new URL("/newsletter/unsubscribe?done=1", appUrl(request)),
        303,
      );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
