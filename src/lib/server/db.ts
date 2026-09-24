import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions, required } from "./config";
import { randomUUID } from "node:crypto";
export function db() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function auth() {
  const jar = await cookies();
  return createServerClient(
    required("SUPABASE_URL"),
    required("SUPABASE_ANON_KEY"),
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Proxy refreshes server component cookies. */
          }
        },
      },
    },
  );
}
export async function user() {
  const client = await auth();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
export async function withLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const owner = randomUUID();
  const { data, error } = await db().rpc("squid_claim_lock", {
    lock_key: key,
    lock_owner: owner,
  });
  if (error)
    throw new Error("Database setup is incomplete. Apply the Squid migration.");
  if (!data)
    throw new Error(
      "This action is already in progress. Please retry shortly.",
    );
  try {
    return await run();
  } finally {
    await db().from("squid_locks").delete().eq("key", key).eq("owner", owner);
  }
}
export function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): T {
  if (result.error)
    throw new Error(
      "Could not save or load this record. Check the database setup.",
    );
  return result.data;
}
