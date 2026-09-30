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
export function stationConnectionUrl(
  stationName: string,
  ivoraUrl: string | null,
) {
  const prefix = process.env.OCPP_URL_PREFIX;
  if (!prefix) return ivoraUrl;
  const url = new URL(prefix.replace(/\/+$/, "") + "/");
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid OCPP_URL_PREFIX. Use a secure WebSocket URL.");
  return new URL(encodeURIComponent(stationName), url).toString();
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
