# Contributing

Use Node.js 22+ and run `npm ci`. The `/demo` and `/c/demo` routes let you work on the interface without credentials. Follow the README for service integration; use a separate test Supabase project, Stripe test accounts, and a designated charger.

Keep changes focused. Explain the behavior being fixed, the resulting experience, and relevant validation in your pull request. Run `npm run format`, `npm run typecheck`, `npm test`, and `npm run build`; run browser tests when changing a user flow. CI runs these checks without access to fleet or payment secrets.

Payment changes must preserve integer amounts, the 6% final-value fee, server-verified authorization, matched metering, and stable idempotency keys. Authorization changes must maintain host ownership and guest session isolation. Add regression coverage for consequential behavior. Do not substitute mocked results for a live integration and label it production verified.

Never commit `.env`, provider keys, guest data, real Stripe payloads, or database dumps. Keep UI changes accessible with keyboard navigation, visible focus, reduced-motion support, and phone-sized layouts. Document changes to deployment requirements and environment variables.

Contributions are provided under the repository's Apache-2.0 license. Preserve third-party notices.
