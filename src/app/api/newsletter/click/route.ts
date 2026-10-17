import { NextRequest, NextResponse } from "next/server";
import { recordClick, verifyClick } from "@/lib/server/newsletter";

// Signed redirect for newsletter links. Only links signed for a delivery and
// pointing at an allowed Squid host are followed, so this is not an open
// redirect.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const delivery = params.get("d") ?? "";
  const href = params.get("u") ?? "";
  let valid = false;
  try {
    valid = verifyClick(delivery, href, params.get("s") ?? "");
  } catch {
    valid = false;
  }
  if (!valid)
    return NextResponse.json(
      { error: "This link is not valid." },
      { status: 400 },
    );
  // Counting a click must never block the reader.
  await recordClick(delivery, href).catch(() =>
    console.error("[Squid newsletter] Could not record a click"),
  );
  return NextResponse.redirect(href, {
    status: 302,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
