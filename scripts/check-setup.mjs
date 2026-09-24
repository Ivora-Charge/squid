import { createClient } from "@supabase/supabase-js";
const names = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IVORA_API_URL",
  "IVORA_API_KEY",
  "IVORA_TENANT_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
];
for (const name of names)
  console.log(`${name}: ${process.env[name] ? "set" : "missing"}`);
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/settings`,
      {
        headers: { apikey: process.env.SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("Auth settings unavailable");
    const settings = await response.json();
    console.log(
      "Email/password sign-in:",
      settings.external?.email ? "enabled" : "disabled",
    );
    console.log(
      "Google sign-in:",
      settings.external?.google
        ? "enabled"
        : "disabled — configure the Google provider in Supabase",
    );
    console.log(
      "Google Cloud callback:",
      `${process.env.SUPABASE_URL}/auth/v1/callback`,
    );
    console.log(
      "Squid OAuth callback:",
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`,
    );
  } catch {
    console.log("Auth provider settings: could not verify");
  }
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL) {
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { error } = await client.from("squid_properties").select("id").limit(0);
  console.log(
    "Database schema:",
    error ? "not ready — apply migration" : "ready",
  );
  const { error: emailError } = await client
    .from("squid_rate_limits")
    .select("key")
    .limit(0);
  console.log(
    "Email rate-limit schema:",
    emailError ? "not ready — apply all migrations" : "ready",
  );
}
