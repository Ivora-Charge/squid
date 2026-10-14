import posthog from "posthog-js";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

// Sign-in and password-reset links carry one-use tokens in the URL fragment.
// Those pages leave with a full page load, so analytics simply starts on the
// next page instead of ever seeing the token.
const carriesToken =
  /^\/admin\b/.test(window.location.pathname) ||
  /^\/login\/(confirm|reset)\b/.test(window.location.pathname) ||
  /token/i.test(window.location.hash);

function withoutFragment(url: unknown) {
  return typeof url === "string" ? url.split("#")[0] : url;
}

if (!carriesToken) {
  try {
    if (posthogToken) {
      posthog.init(posthogToken, {
        // Proxied through next.config.ts so ad blockers don't drop events.
        api_host: "/ingest",
        ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(
          ".i.posthog.com",
          ".posthog.com",
        ),
        defaults: "2026-08-30",
        session_recording: { maskAllInputs: true },
        before_send: (event) => {
          if (event?.properties) {
            event.properties.$current_url = withoutFragment(
              event.properties.$current_url,
            );
            event.properties.$referrer = withoutFragment(
              event.properties.$referrer,
            );
          }
          return event;
        },
      });
    }
    if (gaId) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() {
        // gtag.js reads the arguments object itself, not an array.
        window.dataLayer.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", gaId, {
        page_location: withoutFragment(window.location.href),
      });
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
      document.head.appendChild(script);
    }
  } catch (error) {
    console.error("[Squid] analytics", error);
  }
}
