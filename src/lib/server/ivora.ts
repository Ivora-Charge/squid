import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, checked } from "./db";
import { required } from "./config";

export const stationSchema = z.object({
  id: z.number(),
  name: z.string(),
  online: z.boolean(),
  protocol: z.string().nullable(),
  connectors: z.array(
    z.object({
      id: z.number(),
      number: z.number().nullable(),
      status: z.string().nullable(),
    }),
  ),
});
export type Station = z.infer<typeof stationSchema>;
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
  if (!response.ok)
    throw new Error(`Ivora request failed (${response.status}).`);
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
export const getStation = (id: number) =>
  ivora(tenantPath(`stations/${id}`), stationSchema);
export async function getOcppUrl(stationName: string) {
  const domains = await ivora(
    tenantPath("ocpp-domains"),
    z.object({
      data: z.array(
        z.object({ ready: z.boolean(), connection_url_template: z.string() }),
      ),
    }),
  );
  const ready = domains.data.find(
    (d) =>
      d.ready &&
      d.connection_url_template.startsWith("wss://") &&
      d.connection_url_template.includes("{station_id}"),
  );
  return ready
    ? ready.connection_url_template.replace("{station_id}", stationName)
    : null;
}
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
export async function listAll(
  resource: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let after = 0;
  for (let page = 0; page < 30; page++) {
    const result = await ivora(
      tenantPath(`${resource}?limit=100&after=${after}`),
      z.object({
        data: z.array(z.record(z.string(), z.unknown())),
        next_cursor: z.number(),
      }),
    );
    rows.push(...result.data);
    if (!result.data.length || result.next_cursor <= after) return rows;
    after = result.next_cursor;
  }
  throw new Error("Inventory pagination needs review.");
}
export { billSchema };
