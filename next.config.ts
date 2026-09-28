import type { NextConfig } from "next";

// PostHog's ingest host for the project's region, e.g. https://us.i.posthog.com.
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // PostHog's API paths end in a slash; redirecting them breaks ingestion.
  skipTrailingSlashRedirect: true,
  // Phones and other devices use the configured LAN host during development.
  // Keep this explicit; accepting arbitrary origins exposes dev-only endpoints.
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL
    ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname]
    : [],
  // Serve PostHog from Squid's own origin so ad blockers don't drop events.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: `${posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/:path*`,
      },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};
export default config;
