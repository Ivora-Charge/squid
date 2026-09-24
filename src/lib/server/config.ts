import "server-only";
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See the setup guide.`);
  return value;
}
export function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  ).replace(/\/$/, "");
}
export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}
export function authCookieOptions() {
  // Squid uses Supabase exclusively on the server; browser JS needs no tokens.
  return {
    httpOnly: true,
    secure: appUrl().startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
}
