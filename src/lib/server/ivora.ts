import "server-only";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db, checked } from "./db";
import { required } from "./config";

export const stationSchema = z.object({
  id: z.number(),
  name: z.string(),
  online: z.boolean(),
  protocol: z.string().nullable(),
  location_id: z.number().nullable().optional(),
  // Default OCPP WebSocket URL for this station; custom domains publish their own.
  connection_url: z.string().optional(),
  external_reference: z.string().nullable().optional(),
  connectors: z.array(
    z.object({
      id: z.number(),
      number: z.number().nullable(),
      status: z.string().nullable(),
    }),
  ),
});
export type Station = z.infer<typeof stationSchema>;
export const locationRecordSchema = z.object({
  id: z.number(),
  name: z.string(),
  external_reference: z.string().nullable().optional(),
});
export const tariffRecordSchema = z.object({
  id: z.number(),
  currency: z.string(),
  rate_minor_per_kwh: z.number(),
  authorization_minor: z.number(),
  external_reference: z.string().nullable().optional(),
});
const operationSchema = z.object({
  id: z.string(),
  status: z.enum(["dispatching", "succeeded", "rejected", "unknown"]),
  result: z.record(z.string(), z.unknown()).nullable(),
});
export type Operation = z.infer<typeof operationSchema>;
const billSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "final"]),
  total_minor: z.number().int().nonnegative().nullable(),
  energy_kwh: z.string().nullable(),
  transaction_id: z.number().nullable(),
});
export const externalSchema = z.object({
  id: z.string(),
  status: z.enum([
    "prepared",
    "starting",
    "charging",
    "stopping",
    "awaiting_bill",
    "completed",
    "canceled",
    "reconciliation_required",
  ]),
  bill: billSchema,
  usage: z
    .object({
      transaction_id: z.number(),
      active: z.boolean(),
      energy_kwh: z.string().nullable(),
      estimated_minor: z.number().nullable(),
      started_at: z.string().nullable(),
      ended_at: z.string().nullable(),
    })
    .nullable(),
  start_operation: operationSchema.nullable(),
  stop_operation: operationSchema.nullable(),
});
export type ExternalSession = z.infer<typeof externalSchema>;
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  request_id: z.string().optional(),
});
// Every Ivora failure carries a stable code; callers branch on it and the
// generic failure() maps it to a message. The message itself is never shown.
export class IvoraError extends Error {
  readonly name = "IvoraError";
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId: string | null = null,
    public details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}
async function ivoraError(response: Response) {
  const parsed = errorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success
    ? new IvoraError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.request_id ?? null,
        parsed.data.error.details ?? null,
      )
    : new IvoraError(
        response.status,
        response.status === 429 ? "rate_limited" : "http_error",
        `Ivora request failed (${response.status}).`,
      );
}
// A rejected operation repeats the error shape in result.error.
export function rejectionCode(op: Operation) {
  if (op.status !== "rejected") return null;
  const error = op.result?.error as { code?: unknown } | undefined;
  return typeof error?.code === "string" ? error.code : "rejected";
}
export function tenantPath(resource: string) {
  const id = required("IVORA_TENANT_ID");
  if (!/^\d+$/.test(id) || Number(id) < 1)
    throw new Error("Missing valid IVORA_TENANT_ID.");
  return `/v1/tenants/${id}/${resource}`;
}
export async function ivora<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const origin = new URL(
    process.env.IVORA_API_URL || "https://api.ivoracharge.co",
  );
  if (origin.protocol !== "https:") throw new Error("Ivora requires HTTPS.");
  const response = await fetch(new URL(path, origin.origin), {
    method,
    headers: {
      Authorization: `Bearer ${required("IVORA_API_KEY")}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw await ivoraError(response);
  return schema.parse(await response.json());
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function durable<T>(
  key: string,
  input: unknown,
  execute: () => Promise<T>,
  expires = false,
): Promise<T> {
  const hash = createHash("sha256").update(canonical(input)).digest("hex");
  const store = db();
  const insertion = await store
    .from("squid_operations")
    .insert({ key, request_hash: hash });
  if (insertion.error && insertion.error.code !== "23505")
    throw new Error("Could not save the request before sending it.");
  const row = checked(
    await store.from("squid_operations").select("*").eq("key", key).single(),
  );
  if (row.request_hash !== hash)
    throw new Error("Saved request differs; reconcile the original operation.");
  if (row.response !== null) return row.response as T;
  if (expires && Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000)
    throw new Error(
      "Payment authorization needs operator review before retrying.",
    );
  const result = await execute();
  checked(
    await store
      .from("squid_operations")
      .update({ response: result })
      .eq("key", key),
  );
  return result;
}
// Drop a saved request whose operation Ivora rejected outright, so a later
// attempt can dispatch again with the same key. Never used after a dispatch
// that may have reached hardware.
export async function forget(key: string) {
  checked(await db().from("squid_operations").delete().eq("key", key));
}
export async function writeIvora<T>(
  key: string,
  resource: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = "POST",
) {
  const path = tenantPath(resource);
  return durable(key, { path, method, body: body ?? null }, () =>
    ivora(path, schema, method, body, key),
  );
}
type Inventory = "locations" | "stations" | "tariffs";
const RECOVERABLE = new Set([
  "external_reference_taken",
  "station_name_taken",
  "outcome_unknown",
  "request_in_progress",
]);
// Inventory creates are synchronous and return the record. When Ivora already
// holds a resource for our reference (a retry after a lost response, or an
// unanswered create) adopt it through external_reference instead of guessing.
export async function createResource<T extends { id: number }>(
  key: string,
  resource: Inventory,
  schema: z.ZodType<T>,
  body: Record<string, unknown> & { external_reference: string },
): Promise<T> {
  try {
    return await writeIvora(key, resource, schema, body);
  } catch (error) {
    if (!(error instanceof IvoraError) || !RECOVERABLE.has(error.code))
      throw error;
    const existing = await findResource(
      resource,
      schema,
      body.external_reference,
      typeof body.name === "string" ? body.name : undefined,
    );
    if (existing) return existing;
    throw error;
  }
}
async function findResource<T>(
  resource: Inventory,
  schema: z.ZodType<T>,
  reference: string,
  name?: string,
): Promise<T | null> {
  const page = z.object({ data: z.array(schema) });
  const byReference = await ivora(
    tenantPath(
      `${resource}?external_reference=${encodeURIComponent(reference)}&limit=1`,
    ),
    page,
  );
  if (byReference.data[0]) return byReference.data[0];
  // Stations registered before references existed are only findable by name.
  if (!name) return null;
  const byName = await ivora(
    tenantPath(`${resource}?name=${encodeURIComponent(name)}&limit=1`),
    page,
  );
  return (
    byName.data.find((r) => (r as { name?: unknown }).name === name) ?? null
  );
}
export const getStation = (id: number) =>
  ivora(tenantPath(`stations/${id}`), stationSchema);
export const getExternal = (id: string) =>
  ivora(tenantPath(`charging-sessions/${id}`), externalSchema);
export async function operation(
  key: string,
  resource: string,
  body?: unknown,
  method = "POST",
) {
  const initial = await writeIvora(
    key,
    resource,
    operationSchema,
    body,
    method,
  );
  return initial.status === "succeeded" || initial.status === "rejected"
    ? initial
    : ivora(tenantPath(`operations/${initial.id}`), operationSchema);
}
// Ivora signs deliveries as `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
export function verifyWebhookSignature(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
): "ok" | "invalid" | "stale" {
  const parts = Object.fromEntries(
    (header ?? "")
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string]),
  );
  const { t, v1 } = parts;
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[a-f0-9]{64}$/i.test(v1))
    return "invalid";
  const expected = createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(v1.toLowerCase())))
    return "invalid";
  if (Math.abs(now / 1000 - Number(t)) > 5 * 60) return "stale";
  return "ok";
}
export { billSchema };
