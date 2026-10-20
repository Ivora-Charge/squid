import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  failure,
  HttpError,
  requireGuest,
  sameOrigin,
} from "@/lib/server/security";
import { checked, db, LockBusyError } from "@/lib/server/db";
import {
  loadSession,
  publicSession,
  reconcile,
  syncIfStale,
} from "@/lib/server/sessions";
export const maxDuration = 60;
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireGuest(id);
    // A database read. Webhooks and the cron move the snapshot forward; Ivora is
    // reached only when the snapshot is stale, at most once per window.
    let session;
    try {
      session = await syncIfStale(id);
    } catch (error) {
      // A failed fallback must not hide the stored snapshot.
      if (error instanceof HttpError) throw error;
      session = await loadSession(id);
    }
    return NextResponse.json(
      { session: publicSession(session) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    await requireGuest(id);
    const { action } = z
      .object({ action: z.enum(["sync", "stop"]) })
      .parse(await request.json());
    if (action === "stop")
      checked(
        await db()
          .from("squid_sessions")
          .update({ stop_requested: true })
          .eq("id", id),
      );
    try {
      // "stop" reconciles immediately; "sync" only when the snapshot is stale.
      return NextResponse.json(
        {
          session: publicSession(
            action === "stop" ? await reconcile(id) : await syncIfStale(id),
          ),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      if (!(error instanceof LockBusyError)) throw error;
      // Another worker owns reconciliation. A stop request is already persisted;
      // return the latest snapshot while that worker or the next poll finishes it.
      return NextResponse.json(
        { session: publicSession(await loadSession(id)) },
        { status: 202, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  } catch (error) {
    return failure(error);
  }
}
