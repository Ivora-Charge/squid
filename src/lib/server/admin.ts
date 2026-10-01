import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { authCookieOptions, supabaseConfigured } from "./config";
import { checked, db, user } from "./db";
import { HttpError } from "./http-error";
import type {
  ActingAs,
  AdminAudit,
  AdminSummary,
  Feedback,
  Tenant,
} from "../admin-types";

export const ADMIN_EMAIL = "mingcan@ivoracharge.com";
export const TENANT_COOKIE = "squid_tenant_access";
export function isAdmin(
  actor: Pick<User, "email" | "email_confirmed_at"> | null,
) {
  return Boolean(
    actor?.email_confirmed_at && actor.email?.toLowerCase() === ADMIN_EMAIL,
  );
}
export async function requireAdmin() {
  const actor = supabaseConfigured() ? await user() : null;
  if (!actor) throw new HttpError(401, "Please sign in to continue.");
  if (!isAdmin(actor))
    throw new HttpError(403, "Administrator access required.");
  return actor;
}
export function accessTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function accessEnded(): never {
  throw new HttpError(
    409,
    "Tenant access has ended. Return to admin and open the workspace again.",
  );
}
export async function hostContext(
  actor: User,
): Promise<{ host: User; actingAs: ActingAs | null }> {
  // Browser cookies and user-editable profile metadata cannot grant a role.
  if (!isAdmin(actor)) return { host: actor, actingAs: null };
  const token = (await cookies()).get(TENANT_COOKIE)?.value;
  if (!token) return { host: actor, actingAs: null };
  if (!/^[a-f0-9]{64}$/.test(token)) return accessEnded();
  const access = checked(
    await db()
      .from("squid_tenant_access")
      .select("id,actor_id,tenant_id,expires_at,ended_at")
      .eq("token_hash", accessTokenHash(token))
      .eq("actor_id", actor.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  );
  if (
    !access ||
    access.actor_id !== actor.id ||
    access.ended_at ||
    !Number.isFinite(Date.parse(access.expires_at)) ||
    Date.parse(access.expires_at) <= Date.now()
  )
    return accessEnded();
  const { data, error } = await db().auth.admin.getUserById(access.tenant_id);
  if (
    error ||
    !data.user?.email ||
    data.user.id !== access.tenant_id ||
    data.user.id === actor.id
  )
    return accessEnded();
  return {
    host: data.user,
    actingAs: {
      id: access.id,
      email: data.user.email,
      expiresAt: access.expires_at,
    },
  };
}
export async function authorizeWorkspace(actor: User, request?: NextRequest) {
  const context = await hostContext(actor);
  if (!request) return context;
  const expected = request.headers.get("x-squid-tenant-access");
  if (
    (context.actingAs && expected !== context.actingAs.id) ||
    (!context.actingAs && expected && expected !== "self")
  ) {
    throw new HttpError(
      409,
      "This workspace has changed. Reload the page before making changes.",
    );
  }
  if (context.actingAs) {
    // Record the request before a tenant action can run. No request bodies,
    // payment data, connection passwords, or cookies are included.
    checked(
      await db()
        .from("squid_admin_audit")
        .insert({
          actor_id: actor.id,
          tenant_id: context.host.id,
          access_id: context.actingAs.id,
          event: "tenant_request",
          method: request.method,
          path: request.nextUrl.pathname.slice(0, 200),
        }),
    );
  }
  return context;
}
function rpcResult<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}) {
  if (result.error?.code === "P0002")
    throw new HttpError(404, "Record not found.");
  if (result.error?.code === "42501")
    throw new HttpError(403, "Administrator access required.");
  return checked(result);
}
export async function startTenantAccess(
  actor: User,
  tenantId: string,
  reason: string,
) {
  if (!isAdmin(actor))
    throw new HttpError(403, "Administrator access required.");
  if (tenantId === actor.id)
    throw new HttpError(400, "Use your own host workspace for this account.");
  const { data, error } = await db().auth.admin.getUserById(tenantId);
  if (error || !data.user?.email) throw new HttpError(404, "Tenant not found.");
  const token = randomBytes(32).toString("hex");
  rpcResult(
    await db().rpc("squid_start_tenant_access", {
      admin_id: actor.id,
      target_id: tenantId,
      access_token_hash: accessTokenHash(token),
      access_reason: reason,
    }),
  );
  (await cookies()).set(TENANT_COOKIE, token, {
    ...authCookieOptions(),
    maxAge: 3600,
  });
}
export async function endTenantAccess(actor: User | null) {
  const jar = await cookies();
  const token = jar.get(TENANT_COOKIE)?.value;
  try {
    if (actor && isAdmin(actor)) {
      rpcResult(
        await db().rpc("squid_end_tenant_access", {
          admin_id: actor.id,
          access_token_hash:
            token && /^[a-f0-9]{64}$/.test(token)
              ? accessTokenHash(token)
              : null,
        }),
      );
    }
  } finally {
    jar.set(TENANT_COOKIE, "", { ...authCookieOptions(), maxAge: 0 });
  }
}
export async function adminSummary(): Promise<AdminSummary> {
  return rpcResult(await db().rpc("squid_admin_summary"));
}
export async function adminTenants(
  search = "",
  page = 0,
): Promise<{ tenants: Tenant[]; total: number }> {
  return rpcResult(
    await db().rpc("squid_admin_tenants", {
      search_text: search,
      page_offset: page * 25,
      page_limit: 25,
    }),
  );
}
export async function adminFeedback(
  status: "all" | Feedback["status"] = "all",
  page = 0,
): Promise<{ feedback: Feedback[]; total: number }> {
  let query = db()
    .from("squid_feedback")
    .select(
      "id,submitted_by,tenant_id,email,category,rating,message,page_path,status,created_at",
      { count: "exact" },
    );
  if (status !== "all") query = query.eq("status", status);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 25, page * 25 + 24);
  return { feedback: checked(result) as Feedback[], total: result.count ?? 0 };
}
export async function adminAudit(
  page = 0,
): Promise<{ audit: AdminAudit[]; total: number }> {
  const result = await db()
    .from("squid_admin_audit")
    .select(
      "id,actor_id,tenant_id,access_id,subject_id,event,method,path,reason,created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 25, page * 25 + 24);
  return { audit: checked(result) as AdminAudit[], total: result.count ?? 0 };
}
export async function setFeedbackStatus(
  actor: User,
  id: string,
  status: Feedback["status"],
) {
  rpcResult(
    await db().rpc("squid_admin_feedback_status", {
      admin_id: actor.id,
      feedback_id: id,
      new_status: status,
    }),
  );
}
