import "server-only";
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See the setup guide.`);
  return value;
}
type RequestLike = { headers: Pick<Headers, "get"> };
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// Preview deployments answer at their own hosts (for example
// pr-12.squidcharge.dev). Only allow-listed hosts are trusted; production and
// local development always use the configured origin.
function previewOrigin(request: RequestLike) {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  ).toLowerCase();
  // Rejects ports, credentials, paths, and comma-joined proxy lists.
  if (!HOSTNAME.test(host)) return null;
  const suffix = process.env.PREVIEW_HOST_SUFFIX?.toLowerCase().replace(
    /^\.*/,
    ".",
  );
  const allowed =
    (suffix && HOSTNAME.test(`x${suffix}`) && host.endsWith(suffix)) ||
    [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].some(
      (value) => value?.toLowerCase() === host,
    );
  return allowed ? `https://${host}` : null;
}
export function appUrl(request?: RequestLike) {
  return (
    (request && previewOrigin(request)) ||
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
export function authCookieOptions(request?: RequestLike) {
  // Squid uses Supabase exclusively on the server; browser JS needs no tokens.
  return {
    httpOnly: true,
    secure: appUrl(request).startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
}
