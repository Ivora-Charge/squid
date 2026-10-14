import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminAudit,
  adminFeedback,
  adminSummary,
  adminTenants,
  requireAdmin,
} from "@/lib/server/admin";
import { failure } from "@/lib/server/security";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const input = z
      .object({
        view: z.enum(["tenants", "feedback", "audit"]).default("tenants"),
        search: z.string().trim().max(100).default(""),
        status: z.enum(["all", "new", "reviewing", "resolved"]).default("all"),
        page: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse({
        view: params.get("view") ?? undefined,
        search: params.get("search") ?? undefined,
        status: params.get("status") ?? undefined,
        page: params.get("page") ?? undefined,
      });
    const [summary, result] = await Promise.all([
      adminSummary(),
      input.view === "tenants"
        ? adminTenants(input.search, input.page)
        : input.view === "feedback"
          ? adminFeedback(input.status, input.page)
          : adminAudit(input.page),
    ]);
    return NextResponse.json(
      { ...result, summary },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
