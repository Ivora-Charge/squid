// Upserts the ADMIN_EMAILS list (comma separated) into public.squid_admins,
// using the service role. Idempotent: run it after every change to
// ADMIN_EMAILS. It only adds admins; to remove one, delete the row:
//   delete from public.squid_admins where email = 'someone@example.com';
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export function parseAdminEmails(value = "") {
  return [
    ...new Set(
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** @param {Record<string, string | undefined>} [env] */
export function resolveSupabaseUrl(env = process.env) {
  return env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Returns the number of admin emails written; throws Error with a safe
 * message on any problem.
 * @param {Record<string, string | undefined>} [env]
 * @param {typeof createClient} [create]
 */
export async function seedAdmins(env = process.env, create = createClient) {
  const url = resolveSupabaseUrl(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  const emails = parseAdminEmails(env.ADMIN_EMAILS);
  if (!emails.length) throw new Error("ADMIN_EMAILS is empty. Nothing to do.");
  const invalid = emails.filter((email) => !/^[^\s@]+@[^\s@]+$/.test(email));
  if (invalid.length) {
    throw new Error(`ADMIN_EMAILS has ${invalid.length} invalid entries.`);
  }
  const supabase = create(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("squid_admins").upsert(
    emails.map((email) => ({ email })),
    { onConflict: "email", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(
      `Could not write squid_admins (${error.code ?? "error"}). Apply the 202610220001_squid_admins.sql migration first.`,
    );
  }
  return emails.length;
}

async function main() {
  try {
    const count = await seedAdmins();
    console.log(`squid_admins now includes ${count} admin email(s).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
