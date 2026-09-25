import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/server/db";
import { reconcile } from "@/lib/server/sessions";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const actual = request.headers.get("authorization") ?? "";
  if (
    !process.env.CRON_SECRET ||
    expected.length !== actual.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db()
    .from("squid_sessions")
    .select("id")
    .or("status.not.in.(completed,canceled,refunded),refund_requested.eq.true")
    .order("updated_at")
    .limit(10);
  if (error)
    return NextResponse.json(
      { error: "Database unavailable." },
      { status: 503 },
    );
  await db()
    .from("squid_rate_limits")
    .delete()
    .lt("resets_at", new Date(Date.now() - 86400000).toISOString());
  // Ivora retries deliveries for about a day; a week of ids covers late ones.
  await db()
    .from("squid_ivora_events")
    .delete()
    .lt("received_at", new Date(Date.now() - 7 * 86400000).toISOString());
  const results = await Promise.allSettled(
    (data ?? []).map(async (s) => {
      try {
        return await reconcile(s.id);
      } finally {
        // Rotate pending and failed sessions so one outage cannot starve the queue.
        await db()
          .from("squid_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", s.id);
      }
    }),
  );
  return NextResponse.json({
    processed: results.filter((r) => r.status === "fulfilled").length,
    retry: results.filter((r) => r.status === "rejected").length,
  });
}
