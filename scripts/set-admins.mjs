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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.",
    );
    process.exit(1);
  }
  const emails = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (!emails.length) {
    console.error("ADMIN_EMAILS is empty. Nothing to do.");
    process.exit(1);
  }
  const invalid = emails.filter((email) => !/^[^\s@]+@[^\s@]+$/.test(email));
  if (invalid.length) {
    console.error(`ADMIN_EMAILS has ${invalid.length} invalid entries.`);
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("squid_admins").upsert(
    emails.map((email) => ({ email })),
    { onConflict: "email", ignoreDuplicates: true },
  );
  if (error) {
    console.error(
      `Could not write squid_admins (${error.code ?? "error"}). Apply the 202610220001_squid_admins.sql migration first.`,
    );
    process.exit(1);
  }
  console.log(`squid_admins now includes ${emails.length} admin email(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
